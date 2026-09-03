import type { Prisma } from '../../generated/prisma/client.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { loadStripeCheckoutIntegration } from '../integrations/stripe-checkout-integration.ts';
import { PaymentProviderError, normalizePaymentIdempotencyKey } from '../payments/payment-provider.ts';
import { PaymentConflictError } from '../payments/payment-service.ts';
import { isInternalPaymentClaimReference, paymentOperationClaimReference } from '../payments/stripe-payment-service.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { deriveHospitalityCommercialAmendmentRecoveryDecision } from './booking-commercial-amendment-recovery-domain.ts';
import {
  STRIPE_RECOVERY_CHECKOUT_IDEMPOTENCY_PREFIX,
  isStripeCheckoutSessionReference,
  stripeCommercialAmendmentRecoveryCheckoutFingerprint,
  stripeCommercialAmendmentRecoveryCheckoutIdempotencyKey,
} from './booking-commercial-amendment-stripe-recovery-checkout-domain.ts';
import { hospitalityBookingMutationLockKey } from './hospitality-booking-mutation-lock.ts';
import { HospitalityBookingConflictError, HospitalityBookingUnavailableError } from './hospitality-booking-service.ts';

const STRIPE_PROVIDER_CODE = 'stripe';

type RecoveryContext = Awaited<ReturnType<typeof loadRecoveryContext>>;
type RecoveryTransaction = RecoveryContext['transactions'][number];

function paymentLockKey(organizationId: string, bookingId: string) {
  return `payment:${organizationId}:booking:${bookingId}`;
}

function idempotencyLockKey(organizationId: string, idempotencyKey: string) {
  return `payment:${organizationId}:idempotency:${idempotencyKey}`;
}

async function requireRecoveryPermissions(input: { organizationId: string; actorUserId: string }) {
  await Promise.all([
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'booking:manage' }),
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'payment:manage' }),
  ]);
}

async function lockRecoveryWrite(input: {
  transaction: Prisma.TransactionClient;
  organizationId: string;
  bookingId: string;
  idempotencyKey: string;
}) {
  await input.transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityBookingMutationLockKey({
    organizationId: input.organizationId,
    bookingId: input.bookingId,
  })}, 0))`;
  await input.transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(input.organizationId, input.bookingId)}, 0))`;
  await input.transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${idempotencyLockKey(input.organizationId, input.idempotencyKey)}, 0))`;
}

async function loadRecoveryContext(input: {
  transaction: Prisma.TransactionClient;
  organizationId: string;
  bookingId: string;
  amendmentId: string;
}) {
  const amendment = await input.transaction.hospitalityBookingCommercialAmendment.findFirst({
    where: { id: input.amendmentId, organizationId: input.organizationId, bookingId: input.bookingId },
    select: {
      id: true,
      status: true,
      direction: true,
      paymentProviderCode: true,
      currency: true,
      beforeTotalMinor: true,
      afterTotalMinor: true,
      deltaMinor: true,
      createdAt: true,
      expiresAt: true,
      bookingVersion: true,
    },
  });
  if (!amendment) throw new HospitalityBookingUnavailableError('Commercial amendment is not available in this organization.');

  const booking = await input.transaction.hospitalityBooking.findFirst({
    where: { id: input.bookingId, organizationId: input.organizationId },
    select: {
      id: true,
      status: true,
      paymentStatus: true,
      currency: true,
      totalMinor: true,
      updatedAt: true,
      customer: { select: { email: true } },
    },
  });
  if (!booking) throw new HospitalityBookingUnavailableError();

  const transactions = await input.transaction.paymentTransaction.findMany({
    where: { organizationId: input.organizationId, bookingId: input.bookingId },
    select: {
      id: true,
      bookingId: true,
      commercialAmendmentId: true,
      idempotencyKey: true,
      requestFingerprint: true,
      kind: true,
      status: true,
      providerCode: true,
      providerReference: true,
      sourceProviderReference: true,
      currency: true,
      amountMinor: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  return { amendment, booking, transactions };
}

function assertRecoverySnapshot(context: RecoveryContext) {
  if (
    context.amendment.status !== 'PREPARED'
    || context.amendment.direction !== 'REFUND'
    || context.amendment.paymentProviderCode !== STRIPE_PROVIDER_CODE
    || context.booking.status !== 'CONFIRMED'
    || context.booking.paymentStatus !== 'PAID'
    || context.booking.currency !== context.amendment.currency
    || context.booking.totalMinor !== context.amendment.beforeTotalMinor
    || context.booking.updatedAt.getTime() !== context.amendment.bookingVersion.getTime()
  ) {
    throw new HospitalityBookingConflictError(
      'Booking or commercial amendment changed before Stripe recovery Checkout could be created.',
    );
  }
}

function deriveRecoveryDecision(context: RecoveryContext, now: Date, omittedTransactionId?: string) {
  return deriveHospitalityCommercialAmendmentRecoveryDecision({
    amendmentId: context.amendment.id,
    status: context.amendment.status,
    direction: context.amendment.direction,
    paymentProviderCode: context.amendment.paymentProviderCode,
    currency: context.amendment.currency,
    beforeTotalMinor: context.amendment.beforeTotalMinor,
    afterTotalMinor: context.amendment.afterTotalMinor,
    deltaMinor: context.amendment.deltaMinor,
    createdAt: context.amendment.createdAt,
    expiresAt: context.amendment.expiresAt,
    now,
    transactions: omittedTransactionId
      ? context.transactions.filter((transaction) => transaction.id !== omittedTransactionId)
      : context.transactions,
  });
}

function assertExactCheckoutClaim(input: {
  payment: RecoveryTransaction;
  bookingId: string;
  amendmentId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  currency: string;
  amountMinor: bigint;
}) {
  const payment = input.payment;
  if (
    payment.bookingId !== input.bookingId
    || payment.commercialAmendmentId !== input.amendmentId
    || payment.idempotencyKey !== input.idempotencyKey
    || payment.requestFingerprint !== input.requestFingerprint
    || payment.kind !== 'CAPTURE'
    || payment.providerCode !== STRIPE_PROVIDER_CODE
    || payment.currency !== input.currency
    || payment.amountMinor !== input.amountMinor
    || payment.sourceProviderReference !== null
  ) {
    throw new PaymentConflictError('Stripe recovery Checkout request key was already used for a different operation.');
  }
  if (
    !isInternalPaymentClaimReference(payment.providerReference)
    && !isStripeCheckoutSessionReference(payment.providerReference)
    && !/^pi_[A-Za-z0-9_]+$/.test(payment.providerReference)
  ) {
    throw new PaymentConflictError('Stripe recovery Checkout payment reference is invalid.');
  }
}

function requireAdditionalChargeDecision(context: RecoveryContext, decision: ReturnType<typeof deriveRecoveryDecision>) {
  if (
    decision.state !== 'COMPENSATE'
    || decision.operation !== 'ADDITIONAL_CHARGE'
    || decision.providerCode !== STRIPE_PROVIDER_CODE
  ) {
    const reason = 'reason' in decision ? decision.reason : 'Commercial amendment does not require a Stripe recovery charge.';
    throw new HospitalityBookingConflictError(reason);
  }
  if (decision.currency !== context.amendment.currency || decision.amountMinor <= 0n) {
    throw new HospitalityBookingConflictError('Stripe recovery Checkout money is invalid.');
  }
  return decision;
}

async function markCheckoutClaimFailed(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  amendmentId: string;
  paymentId: string;
  idempotencyKey: string;
  failureCode: string;
}) {
  await db.$transaction(async (transaction) => {
    await lockRecoveryWrite({ transaction, organizationId: input.organizationId, bookingId: input.bookingId, idempotencyKey: input.idempotencyKey });
    const payment = await transaction.paymentTransaction.findFirst({
      where: {
        id: input.paymentId,
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        commercialAmendmentId: input.amendmentId,
        idempotencyKey: input.idempotencyKey,
        providerCode: STRIPE_PROVIDER_CODE,
        kind: 'CAPTURE',
        status: 'AMBIGUOUS',
      },
    });
    if (!payment || !isInternalPaymentClaimReference(payment.providerReference)) return;
    const updated = await transaction.paymentTransaction.update({ where: { id: payment.id }, data: { status: 'FAILED' } });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'payment.commercial-amendment.stripe-recovery-checkout-failed',
        resourceType: 'payment-transaction',
        resourceId: updated.id,
        afterData: {
          bookingId: input.bookingId,
          commercialAmendmentId: input.amendmentId,
          providerCode: STRIPE_PROVIDER_CODE,
          kind: 'CAPTURE',
          status: 'FAILED',
          failureCode: input.failureCode,
          bookingPaymentStatePreservedUntilRecoveryCompletes: true,
        },
      },
    });
  }, { isolationLevel: 'Serializable' });
}

async function bindCheckoutSession(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  amendmentId: string;
  paymentId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  currency: string;
  amountMinor: bigint;
  sessionReference: string;
  expiresAt: Date;
}) {
  return db.$transaction(async (transaction) => {
    await lockRecoveryWrite({ transaction, organizationId: input.organizationId, bookingId: input.bookingId, idempotencyKey: input.idempotencyKey });
    const payment = await transaction.paymentTransaction.findFirst({
      where: {
        id: input.paymentId,
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        commercialAmendmentId: input.amendmentId,
        idempotencyKey: input.idempotencyKey,
      },
      select: {
        id: true,
        bookingId: true,
        commercialAmendmentId: true,
        idempotencyKey: true,
        requestFingerprint: true,
        kind: true,
        status: true,
        providerCode: true,
        providerReference: true,
        sourceProviderReference: true,
        currency: true,
        amountMinor: true,
        createdAt: true,
      },
    });
    if (!payment) throw new PaymentConflictError('Stripe recovery Checkout claim is no longer available.');
    assertExactCheckoutClaim({ ...input, payment });
    if (payment.status !== 'AMBIGUOUS') return payment;
    if (isStripeCheckoutSessionReference(payment.providerReference)) {
      if (payment.providerReference !== input.sessionReference) {
        throw new PaymentConflictError('Stripe recovery Checkout claim is already bound to a different Session.');
      }
      return payment;
    }
    if (!isInternalPaymentClaimReference(payment.providerReference)) {
      throw new PaymentConflictError('Stripe recovery Checkout claim cannot be rebound after provider settlement.');
    }

    const duplicate = await transaction.paymentTransaction.findFirst({
      where: {
        organizationId: input.organizationId,
        providerCode: STRIPE_PROVIDER_CODE,
        providerReference: input.sessionReference,
        id: { not: payment.id },
      },
      select: { id: true },
    });
    if (duplicate) throw new PaymentConflictError('Stripe Checkout Session is already bound to another payment transaction.');

    const updated = await transaction.paymentTransaction.update({
      where: { id: payment.id },
      data: { providerReference: input.sessionReference },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'payment.commercial-amendment.stripe-recovery-checkout-created',
        resourceType: 'payment-transaction',
        resourceId: updated.id,
        afterData: {
          bookingId: input.bookingId,
          commercialAmendmentId: input.amendmentId,
          providerCode: STRIPE_PROVIDER_CODE,
          kind: 'CAPTURE',
          status: 'AMBIGUOUS',
          checkoutSessionReference: input.sessionReference,
          checkoutExpiresAt: input.expiresAt.toISOString(),
          currency: input.currency,
          amountMinor: input.amountMinor.toString(),
          bookingPaymentStatePreservedUntilRecoveryCompletes: true,
        },
      },
    });
    return updated;
  }, { isolationLevel: 'Serializable' });
}

export async function createStripeHospitalityBookingCommercialAmendmentRecoveryCheckout(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  amendmentId: string;
  requestKey: unknown;
  successUrl: string;
  cancelUrl: string;
  now?: Date;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  assertUuidIdentifier(input.amendmentId, 'amendmentId');
  const requestKey = normalizePaymentIdempotencyKey(input.requestKey);
  const idempotencyKey = stripeCommercialAmendmentRecoveryCheckoutIdempotencyKey({
    organizationId: input.organizationId,
    bookingId: input.bookingId,
    amendmentId: input.amendmentId,
    requestKey,
  });
  const now = input.now ?? new Date();
  await requireRecoveryPermissions(input);

  const action = await db.$transaction(async (transaction) => {
    await lockRecoveryWrite({ transaction, organizationId: input.organizationId, bookingId: input.bookingId, idempotencyKey });
    const context = await loadRecoveryContext({ transaction, ...input });
    assertRecoverySnapshot(context);

    const existing = context.transactions.find((transaction) => transaction.idempotencyKey === idempotencyKey) ?? null;
    const decision = requireAdditionalChargeDecision(context, deriveRecoveryDecision(context, now, existing?.id));
    const requestFingerprint = stripeCommercialAmendmentRecoveryCheckoutFingerprint({
      bookingId: input.bookingId,
      amendmentId: input.amendmentId,
      currency: decision.currency,
      amountMinor: decision.amountMinor,
    });

    const competing = context.transactions.find((transaction) => (
      transaction.id !== existing?.id
      && transaction.commercialAmendmentId === input.amendmentId
      && transaction.idempotencyKey.startsWith(STRIPE_RECOVERY_CHECKOUT_IDEMPOTENCY_PREFIX)
      && (transaction.status === 'PENDING' || transaction.status === 'AMBIGUOUS')
    ));
    if (competing) {
      throw new PaymentConflictError('Commercial amendment already has an unresolved customer-authorized Stripe recovery Checkout.');
    }

    if (existing) {
      assertExactCheckoutClaim({
        payment: existing,
        bookingId: input.bookingId,
        amendmentId: input.amendmentId,
        idempotencyKey,
        requestFingerprint,
        currency: decision.currency,
        amountMinor: decision.amountMinor,
      });
      if (existing.status === 'FAILED') {
        throw new PaymentConflictError('This Stripe recovery Checkout attempt ended definitively. Start a new customer payment attempt with a fresh request key.');
      }
      if (existing.status === 'SUCCEEDED') {
        return { kind: 'SETTLED' as const, payment: existing, decision, customerEmail: context.booking.customer.email };
      }
      return { kind: 'CHECKOUT' as const, payment: existing, decision, requestFingerprint, customerEmail: context.booking.customer.email };
    }

    const payment = await transaction.paymentTransaction.create({
      data: {
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        commercialAmendmentId: input.amendmentId,
        idempotencyKey,
        requestFingerprint,
        kind: 'CAPTURE',
        status: 'AMBIGUOUS',
        providerCode: STRIPE_PROVIDER_CODE,
        providerReference: paymentOperationClaimReference(requestFingerprint),
        currency: decision.currency,
        amountMinor: decision.amountMinor,
      },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'payment.commercial-amendment.stripe-recovery-checkout-claimed',
        resourceType: 'payment-transaction',
        resourceId: payment.id,
        afterData: {
          bookingId: input.bookingId,
          commercialAmendmentId: input.amendmentId,
          providerCode: STRIPE_PROVIDER_CODE,
          kind: 'CAPTURE',
          status: 'AMBIGUOUS',
          currency: decision.currency,
          amountMinor: decision.amountMinor.toString(),
          customerAuthorizationRequired: true,
          bookingPaymentStatePreservedUntilRecoveryCompletes: true,
        },
      },
    });
    return { kind: 'CHECKOUT' as const, payment, decision, requestFingerprint, customerEmail: context.booking.customer.email };
  }, { isolationLevel: 'Serializable' });

  if (action.kind === 'SETTLED') {
    return Object.freeze({
      state: 'PAYMENT_CONFIRMED' as const,
      checkoutUrl: null,
      expiresAt: null,
      currency: action.decision.currency,
      amountMinor: action.decision.amountMinor,
    });
  }

  const stripe = await loadStripeCheckoutIntegration(input.organizationId);
  if (!stripe.integration.capabilities.includes('payment-capture')) {
    throw new HospitalityBookingConflictError('Stripe integration is not configured for payment capture.');
  }

  try {
    const checkout = await stripe.provider.createPaymentSession({
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      commercialAmendmentId: input.amendmentId,
      purpose: 'commercial-amendment-recovery',
      idempotencyKey,
      money: { currency: action.decision.currency, amountMinor: action.decision.amountMinor },
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      customerEmail: action.customerEmail,
      now,
    });
    if (checkout.expiresAt.getTime() <= now.getTime()) {
      throw new PaymentConflictError('Stripe recovery Checkout Session has already expired and requires signed provider reconciliation before retry.');
    }
    await bindCheckoutSession({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      bookingId: input.bookingId,
      amendmentId: input.amendmentId,
      paymentId: action.payment.id,
      idempotencyKey,
      requestFingerprint: action.requestFingerprint,
      currency: action.decision.currency,
      amountMinor: action.decision.amountMinor,
      sessionReference: checkout.sessionReference,
      expiresAt: checkout.expiresAt,
    });
    return Object.freeze({
      state: 'CHECKOUT_REQUIRED' as const,
      checkoutUrl: checkout.checkoutUrl,
      expiresAt: checkout.expiresAt.toISOString(),
      currency: checkout.money.currency,
      amountMinor: checkout.money.amountMinor,
    });
  } catch (error) {
    if (error instanceof PaymentProviderError && !error.retryable) {
      await markCheckoutClaimFailed({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        bookingId: input.bookingId,
        amendmentId: input.amendmentId,
        paymentId: action.payment.id,
        idempotencyKey,
        failureCode: error.code,
      });
    }
    throw error;
  }
}
