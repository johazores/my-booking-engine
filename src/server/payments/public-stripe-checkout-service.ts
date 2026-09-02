import { hospitalityBookingMutationLockKey } from '../bookings/hospitality-booking-mutation-lock.ts';
import { verifyPublicBookingBookingCapability, PublicBookingCapabilityConfigurationError } from '../bookings/public-booking-capability.ts';
import { derivePublicBookingCheckoutIdempotencyKey } from '../bookings/public-booking-request-domain.ts';
import { PublicHospitalityBookingUnavailableError } from '../bookings/public-hospitality-search-service.ts';
import { readPublicOrganizationBrandingBySlug } from '../branding/branding-service.ts';
import { db } from '../database.ts';
import { loadStripeCheckoutIntegration } from '../integrations/stripe-checkout-integration.ts';
import { PaymentConflictError, PaymentUnavailableError } from './payment-service.ts';
import { PaymentProviderError } from './payment-provider.ts';
import { paymentOperationClaimReference, paymentRequestFingerprint } from './stripe-payment-service.ts';

const STRIPE_PROVIDER_CODE = 'stripe';

export class PublicStripeCheckoutAuthorizationError extends Error {
  constructor() {
    super('Public booking payment capability is invalid or expired.');
    this.name = 'PublicStripeCheckoutAuthorizationError';
  }
}

export class PublicStripeCheckoutUnavailableError extends Error {
  constructor(message = 'Stripe Checkout is not available for this booking.') {
    super(message);
    this.name = 'PublicStripeCheckoutUnavailableError';
  }
}

function publicBookingSecret() {
  const secret = process.env.SF_PUBLIC_BOOKING_SECRET?.trim();
  if (!secret) throw new PublicBookingCapabilityConfigurationError('SF_PUBLIC_BOOKING_SECRET is required for public booking writes.');
  return secret;
}

function assertExactCheckoutClaim(existing: {
  bookingId: string;
  kind: string;
  providerCode: string;
  currency: string;
  amountMinor: bigint;
  requestFingerprint: string | null;
}, expected: {
  bookingId: string;
  currency: string;
  amountMinor: bigint;
  requestFingerprint: string;
}) {
  if (
    existing.bookingId !== expected.bookingId
    || existing.kind !== 'CAPTURE'
    || existing.providerCode !== STRIPE_PROVIDER_CODE
    || existing.currency !== expected.currency
    || existing.amountMinor !== expected.amountMinor
    || existing.requestFingerprint !== expected.requestFingerprint
  ) {
    throw new PaymentConflictError('Payment request key was already used for a different public Checkout operation.');
  }
}

async function markCheckoutClaimFailed(input: {
  organizationId: string;
  bookingId: string;
  principalId: string;
  paymentId: string;
  failureCode: string;
}) {
  await db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityBookingMutationLockKey({ organizationId: input.organizationId, bookingId: input.bookingId })}, 0))`;
    const payment = await transaction.paymentTransaction.findFirst({
      where: { id: input.paymentId, organizationId: input.organizationId, bookingId: input.bookingId },
    });
    if (!payment || payment.status !== 'PENDING' || !payment.providerReference.startsWith('sf_claim_')) return;

    await transaction.paymentTransaction.update({ where: { id: payment.id }, data: { status: 'FAILED' } });
    await transaction.hospitalityBooking.updateMany({
      where: { id: input.bookingId, organizationId: input.organizationId, paymentStatus: { in: ['UNPAID', 'FAILED'] } },
      data: { paymentStatus: 'FAILED' },
    });
    await transaction.publicBookingAuditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorPrincipalId: input.principalId,
        action: 'public-booking.payment-failed',
        resourceType: 'payment-transaction',
        resourceId: payment.id,
        afterData: {
          bookingId: input.bookingId,
          providerCode: STRIPE_PROVIDER_CODE,
          kind: 'CAPTURE',
          status: 'FAILED',
          failureCode: input.failureCode,
        },
      },
    });
  }, { isolationLevel: 'Serializable' });
}

async function persistCheckoutSession(input: {
  organizationId: string;
  bookingId: string;
  principalId: string;
  paymentId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  providerReference: string;
  expiresAt: Date;
}) {
  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`payment:${input.organizationId}:idempotency:${input.idempotencyKey}`}, 0))`;
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityBookingMutationLockKey({ organizationId: input.organizationId, bookingId: input.bookingId })}, 0))`;

    const payment = await transaction.paymentTransaction.findFirst({
      where: {
        id: input.paymentId,
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        idempotencyKey: input.idempotencyKey,
      },
    });
    if (!payment) throw new PaymentConflictError('Checkout payment claim is no longer available.');
    assertExactCheckoutClaim(payment, {
      bookingId: input.bookingId,
      currency: payment.currency,
      amountMinor: payment.amountMinor,
      requestFingerprint: input.requestFingerprint,
    });

    const existingByPayment = await transaction.paymentCheckoutSession.findUnique({
      where: {
        organizationId_paymentTransactionId: {
          organizationId: input.organizationId,
          paymentTransactionId: payment.id,
        },
      },
    });
    if (existingByPayment) {
      if (
        existingByPayment.bookingId !== input.bookingId
        || existingByPayment.publicPrincipalId !== input.principalId
        || existingByPayment.providerCode !== STRIPE_PROVIDER_CODE
        || existingByPayment.providerReference !== input.providerReference
      ) {
        throw new PaymentConflictError('Checkout payment claim is already bound to a different provider session.');
      }
      return existingByPayment;
    }

    const existingByReference = await transaction.paymentCheckoutSession.findUnique({
      where: {
        organizationId_providerCode_providerReference: {
          organizationId: input.organizationId,
          providerCode: STRIPE_PROVIDER_CODE,
          providerReference: input.providerReference,
        },
      },
      select: { paymentTransactionId: true },
    });
    if (existingByReference && existingByReference.paymentTransactionId !== payment.id) {
      throw new PaymentConflictError('Stripe Checkout Session is already bound to another payment transaction.');
    }

    const checkoutSession = await transaction.paymentCheckoutSession.create({
      data: {
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        publicPrincipalId: input.principalId,
        paymentTransactionId: payment.id,
        providerCode: STRIPE_PROVIDER_CODE,
        providerReference: input.providerReference,
        status: 'OPEN',
        expiresAt: input.expiresAt,
      },
    });
    await transaction.publicBookingAuditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorPrincipalId: input.principalId,
        action: 'public-booking.payment-checkout-created',
        resourceType: 'payment-checkout-session',
        resourceId: checkoutSession.id,
        afterData: {
          bookingId: input.bookingId,
          providerCode: STRIPE_PROVIDER_CODE,
          status: 'OPEN',
          expiresAt: input.expiresAt.toISOString(),
        },
      },
    });
    return checkoutSession;
  }, { isolationLevel: 'Serializable' });
}

export async function createPublicStripeCheckoutSession(input: {
  organizationSlug: string;
  bookingCapability: string;
  requestKey: string;
  successUrl: string;
  cancelUrl: string;
  now?: Date;
}) {
  const branding = await readPublicOrganizationBrandingBySlug(input.organizationSlug);
  if (!branding) throw new PublicHospitalityBookingUnavailableError();

  const now = input.now ?? new Date();
  const secret = publicBookingSecret();
  const capability = verifyPublicBookingBookingCapability({
    secret,
    token: input.bookingCapability,
    expectedOrganizationId: branding.id,
    now,
  });
  if (!capability) throw new PublicStripeCheckoutAuthorizationError();

  const ownership = await db.publicBookingBookingOwnership.findUnique({
    where: { organizationId_bookingId: { organizationId: branding.id, bookingId: capability.bookingId } },
  });
  if (!ownership || ownership.principalId !== capability.principalId) throw new PublicStripeCheckoutAuthorizationError();

  const principal = await db.publicBookingPrincipal.findFirst({
    where: { id: capability.principalId, organizationId: branding.id, expiresAt: { gt: now } },
    select: { id: true },
  });
  if (!principal) throw new PublicStripeCheckoutAuthorizationError();

  const booking = await db.hospitalityBooking.findFirst({
    where: { id: capability.bookingId, organizationId: branding.id },
    select: {
      id: true,
      status: true,
      paymentStatus: true,
      currency: true,
      totalMinor: true,
      customer: { select: { email: true } },
    },
  });
  if (!booking) throw new PaymentUnavailableError('Booking is not available in this organization.');
  if (booking.status !== 'CONFIRMED') throw new PaymentConflictError('Only confirmed public bookings can start payment.');
  if (booking.totalMinor <= 0n) throw new PaymentConflictError('A zero-value booking does not require Stripe Checkout.');
  if (booking.paymentStatus === 'PAID' || booking.paymentStatus === 'PARTIALLY_REFUNDED' || booking.paymentStatus === 'REFUNDED') {
    return Object.freeze({ state: 'PAID' as const, paymentStatus: booking.paymentStatus, checkoutUrl: null, expiresAt: null });
  }
  if (booking.paymentStatus === 'AUTHORIZED') {
    return Object.freeze({ state: 'PROCESSING' as const, paymentStatus: booking.paymentStatus, checkoutUrl: null, expiresAt: null });
  }

  const idempotencyKey = derivePublicBookingCheckoutIdempotencyKey({ secret, organizationId: branding.id, requestKey: input.requestKey });
  const requestFingerprint = paymentRequestFingerprint([
    STRIPE_PROVIDER_CODE,
    'public-checkout',
    booking.id,
    booking.currency,
    booking.totalMinor.toString(),
  ]);
  const claimReference = paymentOperationClaimReference(requestFingerprint);

  const prior = await db.paymentTransaction.findUnique({
    where: { organizationId_idempotencyKey: { organizationId: branding.id, idempotencyKey } },
  });
  if (prior) {
    assertExactCheckoutClaim(prior, {
      bookingId: booking.id,
      currency: booking.currency,
      amountMinor: booking.totalMinor,
      requestFingerprint,
    });
    if (prior.status === 'SUCCEEDED') {
      return Object.freeze({ state: 'PAID' as const, paymentStatus: 'PAID', checkoutUrl: null, expiresAt: null });
    }
    if (prior.status === 'FAILED') throw new PaymentConflictError('This Checkout attempt failed. Start a new payment attempt.');
    if (prior.providerReference !== claimReference) {
      return Object.freeze({ state: 'PROCESSING' as const, paymentStatus: booking.paymentStatus, checkoutUrl: null, expiresAt: null });
    }
  }

  const stripe = await loadStripeCheckoutIntegration(branding.id);
  if (!stripe.integration.capabilities.includes('payment-capture')) {
    throw new PublicStripeCheckoutUnavailableError('Stripe integration is not configured for payment capture.');
  }

  const claim = await db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`payment:${branding.id}:idempotency:${idempotencyKey}`}, 0))`;
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityBookingMutationLockKey({ organizationId: branding.id, bookingId: booking.id })}, 0))`;

    const existing = await transaction.paymentTransaction.findUnique({
      where: { organizationId_idempotencyKey: { organizationId: branding.id, idempotencyKey } },
    });
    if (existing) {
      assertExactCheckoutClaim(existing, {
        bookingId: booking.id,
        currency: booking.currency,
        amountMinor: booking.totalMinor,
        requestFingerprint,
      });
      if (existing.status !== 'PENDING' || existing.providerReference !== claimReference) {
        return { payment: existing, callProvider: false } as const;
      }
      return { payment: existing, callProvider: true } as const;
    }

    const currentBooking = await transaction.hospitalityBooking.findFirst({
      where: { id: booking.id, organizationId: branding.id },
      select: { status: true, paymentStatus: true, currency: true, totalMinor: true },
    });
    if (!currentBooking || currentBooking.status !== 'CONFIRMED' || currentBooking.currency !== booking.currency || currentBooking.totalMinor !== booking.totalMinor) {
      throw new PaymentConflictError('Booking changed before Stripe Checkout could be claimed.');
    }
    if (currentBooking.paymentStatus !== 'UNPAID' && currentBooking.paymentStatus !== 'FAILED') {
      throw new PaymentConflictError(`Booking payment state ${currentBooking.paymentStatus.toLowerCase()} no longer accepts Checkout.`);
    }

    const blockingPayment = await transaction.paymentTransaction.findFirst({
      where: {
        organizationId: branding.id,
        bookingId: booking.id,
        providerCode: STRIPE_PROVIDER_CODE,
        kind: { in: ['AUTHORIZATION', 'CAPTURE'] },
        status: { in: ['PENDING', 'AMBIGUOUS', 'SUCCEEDED'] },
      },
      select: { id: true },
    });
    if (blockingPayment) throw new PaymentConflictError('Booking already has an unresolved or successful Stripe payment attempt.');

    const payment = await transaction.paymentTransaction.create({
      data: {
        organizationId: branding.id,
        bookingId: booking.id,
        idempotencyKey,
        requestFingerprint,
        kind: 'CAPTURE',
        status: 'PENDING',
        providerCode: STRIPE_PROVIDER_CODE,
        providerReference: claimReference,
        currency: booking.currency,
        amountMinor: booking.totalMinor,
      },
    });
    await transaction.publicBookingAuditEvent.create({
      data: {
        organizationId: branding.id,
        actorPrincipalId: capability.principalId,
        action: 'public-booking.payment-started',
        resourceType: 'payment-transaction',
        resourceId: payment.id,
        afterData: {
          bookingId: booking.id,
          providerCode: STRIPE_PROVIDER_CODE,
          kind: 'CAPTURE',
          status: 'PENDING',
          currency: booking.currency,
          amountMinor: booking.totalMinor.toString(),
        },
      },
    });
    return { payment, callProvider: true } as const;
  }, { isolationLevel: 'Serializable' });

  if (!claim.callProvider) {
    if (claim.payment.status === 'SUCCEEDED') {
      return Object.freeze({ state: 'PAID' as const, paymentStatus: 'PAID', checkoutUrl: null, expiresAt: null });
    }
    return Object.freeze({ state: 'PROCESSING' as const, paymentStatus: booking.paymentStatus, checkoutUrl: null, expiresAt: null });
  }

  try {
    const checkout = await stripe.provider.createPaymentSession({
      organizationId: branding.id,
      bookingId: booking.id,
      idempotencyKey,
      money: { currency: booking.currency, amountMinor: booking.totalMinor },
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      customerEmail: booking.customer.email,
      now,
    });
    await persistCheckoutSession({
      organizationId: branding.id,
      bookingId: booking.id,
      principalId: capability.principalId,
      paymentId: claim.payment.id,
      idempotencyKey,
      requestFingerprint,
      providerReference: checkout.sessionReference,
      expiresAt: checkout.expiresAt,
    });
    return Object.freeze({
      state: 'CHECKOUT_REQUIRED' as const,
      paymentStatus: booking.paymentStatus,
      checkoutUrl: checkout.checkoutUrl,
      expiresAt: checkout.expiresAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof PaymentProviderError && !error.retryable) {
      await markCheckoutClaimFailed({
        organizationId: branding.id,
        bookingId: booking.id,
        principalId: capability.principalId,
        paymentId: claim.payment.id,
        failureCode: error.code,
      });
    }
    throw error;
  }
}
