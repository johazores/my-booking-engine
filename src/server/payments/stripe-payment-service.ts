import { createHash } from 'node:crypto';

import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { loadStripePaymentIntegration } from '../integrations/stripe-integration.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { PaymentConflictError, PaymentUnavailableError } from './payment-service.ts';
import {
  PaymentProviderError,
  assertPaymentProviderCapability,
  normalizePaymentIdempotencyKey,
  type PaymentProviderOperationStatus,
  type ProviderPaymentResult,
} from './payment-provider.ts';
import { normalizeStripePaymentMethodReference } from './stripe-payment-provider.ts';

const STRIPE_PROVIDER_CODE = 'stripe';
const INTERNAL_CLAIM_PREFIX = 'sf_claim_';

type ExistingPayment = {
  id: string;
  bookingId: string;
  kind: string;
  status: string;
  providerCode: string;
  providerReference: string;
  currency: string;
  amountMinor: bigint;
  requestFingerprint: string | null;
};

type BookingSnapshot = {
  id: string;
  status: string;
  paymentStatus: string;
  currency: string;
  totalMinor: bigint;
};

function paymentLockKey(organizationId: string, scope: string, value: string) {
  return `payment:${organizationId}:${scope}:${value}`;
}

export function paymentRequestFingerprint(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\u001f'), 'utf8').digest('hex');
}

export function paymentOperationClaimReference(requestFingerprint: string): string {
  if (!/^[0-9a-f]{64}$/.test(requestFingerprint)) throw new Error('Payment request fingerprint is invalid.');
  return `${INTERNAL_CLAIM_PREFIX}${requestFingerprint}`;
}

export function isInternalPaymentClaimReference(value: unknown): boolean {
  return typeof value === 'string' && /^sf_claim_[0-9a-f]{64}$/.test(value);
}

function assertExactExistingOperation(
  existing: ExistingPayment,
  expected: {
    bookingId: string;
    kind: 'AUTHORIZATION' | 'CAPTURE';
    currency: string;
    amountMinor: bigint;
    requestFingerprint: string;
    providerReference?: string;
  },
): void {
  if (
    existing.bookingId !== expected.bookingId
    || existing.kind !== expected.kind
    || existing.providerCode !== STRIPE_PROVIDER_CODE
    || existing.currency !== expected.currency
    || existing.amountMinor !== expected.amountMinor
    || existing.requestFingerprint !== expected.requestFingerprint
    || (expected.providerReference !== undefined && existing.providerReference !== expected.providerReference)
  ) {
    throw new PaymentConflictError('Payment idempotency key was already used for a different operation.');
  }
}

function assertAuthoritativeProviderResult(result: ProviderPaymentResult, booking: BookingSnapshot): void {
  if (
    result.providerCode !== STRIPE_PROVIDER_CODE
    || result.money.currency !== booking.currency
    || result.money.amountMinor !== booking.totalMinor
  ) {
    throw new PaymentConflictError('Stripe returned a payment result that does not match the authoritative booking total.');
  }
}

function requireConfiguredCapability(capabilities: readonly string[], capability: string): void {
  if (!capabilities.includes(capability)) {
    throw new PaymentConflictError(`Stripe integration is not configured for ${capability}.`);
  }
}

export function stripeAuthorizationPersistenceStatus(status: PaymentProviderOperationStatus): {
  transactionStatus: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  bookingPaymentStatus: 'UNPAID' | 'AUTHORIZED' | 'PAID' | 'FAILED';
} {
  if (status === 'AUTHORIZED') return { transactionStatus: 'SUCCEEDED', bookingPaymentStatus: 'AUTHORIZED' };
  if (status === 'PAID') return { transactionStatus: 'SUCCEEDED', bookingPaymentStatus: 'PAID' };
  if (status === 'FAILED') return { transactionStatus: 'FAILED', bookingPaymentStatus: 'FAILED' };
  if (status === 'PENDING') return { transactionStatus: 'PENDING', bookingPaymentStatus: 'UNPAID' };
  throw new PaymentConflictError(`Stripe authorization returned unsupported status ${status.toLowerCase()}.`);
}

export function stripeCapturePersistenceStatus(status: PaymentProviderOperationStatus): {
  transactionStatus: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  bookingPaymentStatus: 'AUTHORIZED' | 'PAID';
} {
  if (status === 'PAID') return { transactionStatus: 'SUCCEEDED', bookingPaymentStatus: 'PAID' };
  if (status === 'FAILED') return { transactionStatus: 'FAILED', bookingPaymentStatus: 'AUTHORIZED' };
  if (status === 'PENDING') return { transactionStatus: 'PENDING', bookingPaymentStatus: 'AUTHORIZED' };
  throw new PaymentConflictError(`Stripe capture returned unsupported status ${status.toLowerCase()}.`);
}

async function loadBooking(organizationId: string, bookingId: string): Promise<BookingSnapshot> {
  const booking = await db.hospitalityBooking.findFirst({
    where: { id: bookingId, organizationId },
    select: { id: true, status: true, paymentStatus: true, currency: true, totalMinor: true },
  });
  if (!booking) throw new PaymentUnavailableError('Booking is not available in this organization.');
  return booking;
}

async function markProviderClaimFailed(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  paymentId: string;
  kind: 'AUTHORIZATION' | 'CAPTURE';
}) {
  await db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(input.organizationId, 'booking', input.bookingId)}, 0))`;
    const payment = await transaction.paymentTransaction.findFirst({
      where: { id: input.paymentId, organizationId: input.organizationId, bookingId: input.bookingId },
    });
    if (!payment || payment.status !== 'PENDING' || !isInternalPaymentClaimReference(payment.providerReference)) return;

    await transaction.paymentTransaction.update({ where: { id: payment.id }, data: { status: 'FAILED' } });
    if (input.kind === 'AUTHORIZATION') {
      await transaction.hospitalityBooking.updateMany({
        where: { id: input.bookingId, organizationId: input.organizationId, paymentStatus: { in: ['UNPAID', 'FAILED'] } },
        data: { paymentStatus: 'FAILED' },
      });
    }
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: input.kind === 'AUTHORIZATION' ? 'payment.authorization-failed' : 'payment.capture-failed',
        resourceType: 'payment-transaction',
        resourceId: payment.id,
        afterData: {
          bookingId: input.bookingId,
          providerCode: STRIPE_PROVIDER_CODE,
          kind: input.kind,
          status: 'FAILED',
        },
      },
    });
  }, { isolationLevel: 'Serializable' });
}

export async function authorizeStripeBookingPayment(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  idempotencyKey: unknown;
  paymentMethodReference: unknown;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  const idempotencyKey = normalizePaymentIdempotencyKey(input.idempotencyKey);

  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'payment:manage' });

  const paymentMethodReference = normalizeStripePaymentMethodReference(input.paymentMethodReference);
  const booking = await loadBooking(input.organizationId, input.bookingId);
  if (booking.status !== 'CONFIRMED') throw new PaymentConflictError('Only confirmed bookings can be authorized for payment.');
  if (booking.totalMinor <= 0n) throw new PaymentConflictError('A zero-value booking does not require payment authorization.');

  const requestFingerprint = paymentRequestFingerprint([
    STRIPE_PROVIDER_CODE,
    'authorize',
    booking.id,
    booking.currency,
    booking.totalMinor.toString(),
    paymentMethodReference,
  ]);
  const claimReference = paymentOperationClaimReference(requestFingerprint);

  const prior = await db.paymentTransaction.findUnique({
    where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey } },
  });
  if (prior) {
    assertExactExistingOperation(prior, {
      bookingId: booking.id,
      kind: 'AUTHORIZATION',
      currency: booking.currency,
      amountMinor: booking.totalMinor,
      requestFingerprint,
    });
    if (prior.status !== 'PENDING' || prior.providerReference !== claimReference) return prior;
  }

  if (booking.paymentStatus !== 'UNPAID' && booking.paymentStatus !== 'FAILED') {
    throw new PaymentConflictError(`Booking payment state ${booking.paymentStatus.toLowerCase()} does not accept a new authorization.`);
  }

  const stripe = await loadStripePaymentIntegration(input.organizationId);
  requireConfiguredCapability(stripe.integration.capabilities, 'payment-authorize');
  assertPaymentProviderCapability(stripe.provider, 'AUTHORIZE');
  if (!stripe.provider.authorizePayment) throw new PaymentConflictError('Stripe integration cannot authorize payments.');

  const claim = await db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(input.organizationId, 'idempotency', idempotencyKey)}, 0))`;
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(input.organizationId, 'booking', booking.id)}, 0))`;

    const existing = await transaction.paymentTransaction.findUnique({
      where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey } },
    });
    if (existing) {
      assertExactExistingOperation(existing, {
        bookingId: booking.id,
        kind: 'AUTHORIZATION',
        currency: booking.currency,
        amountMinor: booking.totalMinor,
        requestFingerprint,
      });
      if (existing.status !== 'PENDING' || existing.providerReference !== claimReference) return { payment: existing, callProvider: false } as const;
      return { payment: existing, callProvider: true } as const;
    }

    const currentBooking = await transaction.hospitalityBooking.findFirst({
      where: { id: booking.id, organizationId: input.organizationId },
      select: { status: true, paymentStatus: true, currency: true, totalMinor: true },
    });
    if (!currentBooking) throw new PaymentUnavailableError('Booking is not available in this organization.');
    if (currentBooking.status !== 'CONFIRMED' || currentBooking.currency !== booking.currency || currentBooking.totalMinor !== booking.totalMinor) {
      throw new PaymentConflictError('Booking changed before payment authorization could be claimed.');
    }
    if (currentBooking.paymentStatus !== 'UNPAID' && currentBooking.paymentStatus !== 'FAILED') {
      throw new PaymentConflictError(`Booking payment state ${currentBooking.paymentStatus.toLowerCase()} no longer accepts authorization.`);
    }

    const blockingAuthorization = await transaction.paymentTransaction.findFirst({
      where: {
        organizationId: input.organizationId,
        bookingId: booking.id,
        providerCode: STRIPE_PROVIDER_CODE,
        kind: 'AUTHORIZATION',
        status: { in: ['PENDING', 'SUCCEEDED'] },
      },
      select: { id: true },
    });
    if (blockingAuthorization) throw new PaymentConflictError('Booking already has an active or successful Stripe authorization.');

    const payment = await transaction.paymentTransaction.create({
      data: {
        organizationId: input.organizationId,
        bookingId: booking.id,
        idempotencyKey,
        requestFingerprint,
        kind: 'AUTHORIZATION',
        status: 'PENDING',
        providerCode: STRIPE_PROVIDER_CODE,
        providerReference: claimReference,
        currency: booking.currency,
        amountMinor: booking.totalMinor,
      },
    });
    return { payment, callProvider: true } as const;
  }, { isolationLevel: 'Serializable' });

  if (!claim.callProvider) return claim.payment;

  let providerResult: ProviderPaymentResult;
  try {
    providerResult = await stripe.provider.authorizePayment({
      organizationId: input.organizationId,
      bookingId: booking.id,
      idempotencyKey,
      money: { currency: booking.currency, amountMinor: booking.totalMinor },
      paymentMethodReference,
    });
  } catch (error) {
    if (error instanceof PaymentProviderError && !error.retryable) {
      await markProviderClaimFailed({ organizationId: input.organizationId, actorUserId: input.actorUserId, bookingId: booking.id, paymentId: claim.payment.id, kind: 'AUTHORIZATION' });
    }
    throw error;
  }

  assertAuthoritativeProviderResult(providerResult, booking);
  const persistence = stripeAuthorizationPersistenceStatus(providerResult.status);

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(input.organizationId, 'idempotency', idempotencyKey)}, 0))`;
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(input.organizationId, 'booking', booking.id)}, 0))`;

    const existing = await transaction.paymentTransaction.findUnique({
      where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey } },
    });
    if (!existing) throw new PaymentConflictError('Stripe authorization claim disappeared before persistence.');
    assertExactExistingOperation(existing, {
      bookingId: booking.id,
      kind: 'AUTHORIZATION',
      currency: booking.currency,
      amountMinor: booking.totalMinor,
      requestFingerprint,
    });
    if (existing.providerReference !== claimReference) {
      assertExactExistingOperation(existing, {
        bookingId: booking.id,
        kind: 'AUTHORIZATION',
        currency: booking.currency,
        amountMinor: booking.totalMinor,
        requestFingerprint,
        providerReference: providerResult.providerReference,
      });
      return existing;
    }

    const currentBooking = await transaction.hospitalityBooking.findFirst({
      where: { id: booking.id, organizationId: input.organizationId },
      select: { status: true, paymentStatus: true, currency: true, totalMinor: true },
    });
    if (!currentBooking) throw new PaymentUnavailableError('Booking is not available in this organization.');
    if (currentBooking.status !== 'CONFIRMED' || currentBooking.currency !== booking.currency || currentBooking.totalMinor !== booking.totalMinor) {
      throw new PaymentConflictError('Booking changed while payment authorization was being processed.');
    }
    if (currentBooking.paymentStatus !== 'UNPAID' && currentBooking.paymentStatus !== 'FAILED') {
      throw new PaymentConflictError(`Booking payment state ${currentBooking.paymentStatus.toLowerCase()} no longer accepts authorization.`);
    }

    const providerReferenceConflict = await transaction.paymentTransaction.findFirst({
      where: {
        organizationId: input.organizationId,
        providerCode: STRIPE_PROVIDER_CODE,
        providerReference: providerResult.providerReference,
        kind: 'AUTHORIZATION',
        id: { not: existing.id },
      },
      select: { bookingId: true },
    });
    if (providerReferenceConflict && providerReferenceConflict.bookingId !== booking.id) {
      throw new PaymentConflictError('Stripe authorization reference belongs to another booking.');
    }

    const payment = await transaction.paymentTransaction.update({
      where: { id: existing.id },
      data: { status: persistence.transactionStatus, providerReference: providerResult.providerReference },
    });
    if (currentBooking.paymentStatus !== persistence.bookingPaymentStatus) {
      await transaction.hospitalityBooking.update({ where: { id: booking.id }, data: { paymentStatus: persistence.bookingPaymentStatus } });
    }
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'payment.authorization-recorded',
        resourceType: 'payment-transaction',
        resourceId: payment.id,
        afterData: {
          bookingId: booking.id,
          providerCode: STRIPE_PROVIDER_CODE,
          kind: payment.kind,
          status: payment.status,
          currency: payment.currency,
          amountMinor: payment.amountMinor.toString(),
          bookingPaymentStatus: persistence.bookingPaymentStatus,
        },
      },
    });
    return payment;
  }, { isolationLevel: 'Serializable' });
}

export async function captureStripeBookingPayment(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  idempotencyKey: unknown;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  const idempotencyKey = normalizePaymentIdempotencyKey(input.idempotencyKey);

  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'payment:manage' });

  const booking = await loadBooking(input.organizationId, input.bookingId);
  if (booking.status !== 'CONFIRMED') throw new PaymentConflictError('Only confirmed bookings can capture an authorized payment.');

  const authorization = await db.paymentTransaction.findFirst({
    where: { organizationId: input.organizationId, bookingId: booking.id, kind: 'AUTHORIZATION', status: 'SUCCEEDED', providerCode: STRIPE_PROVIDER_CODE },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
  });
  if (!authorization) throw new PaymentConflictError('No successful Stripe authorization is available to capture.');
  if (authorization.currency !== booking.currency || authorization.amountMinor !== booking.totalMinor) {
    throw new PaymentConflictError('Stripe authorization no longer matches the authoritative booking total.');
  }

  const requestFingerprint = paymentRequestFingerprint([
    STRIPE_PROVIDER_CODE,
    'capture',
    booking.id,
    booking.currency,
    booking.totalMinor.toString(),
    authorization.providerReference,
  ]);
  const claimReference = paymentOperationClaimReference(requestFingerprint);

  const prior = await db.paymentTransaction.findUnique({
    where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey } },
  });
  if (prior) {
    assertExactExistingOperation(prior, {
      bookingId: booking.id,
      kind: 'CAPTURE',
      currency: booking.currency,
      amountMinor: booking.totalMinor,
      requestFingerprint,
      providerReference: prior.providerReference === claimReference ? undefined : authorization.providerReference,
    });
    if (prior.status !== 'PENDING' || prior.providerReference !== claimReference) return prior;
  }

  if (booking.paymentStatus !== 'AUTHORIZED') {
    throw new PaymentConflictError(`Booking payment state ${booking.paymentStatus.toLowerCase()} does not accept capture.`);
  }

  const stripe = await loadStripePaymentIntegration(input.organizationId);
  requireConfiguredCapability(stripe.integration.capabilities, 'payment-capture');
  assertPaymentProviderCapability(stripe.provider, 'CAPTURE');
  if (!stripe.provider.capturePayment) throw new PaymentConflictError('Stripe integration cannot capture payments.');

  const claim = await db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(input.organizationId, 'idempotency', idempotencyKey)}, 0))`;
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(input.organizationId, 'booking', booking.id)}, 0))`;

    const existing = await transaction.paymentTransaction.findUnique({
      where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey } },
    });
    if (existing) {
      assertExactExistingOperation(existing, {
        bookingId: booking.id,
        kind: 'CAPTURE',
        currency: booking.currency,
        amountMinor: booking.totalMinor,
        requestFingerprint,
        providerReference: existing.providerReference === claimReference ? undefined : authorization.providerReference,
      });
      if (existing.status !== 'PENDING' || existing.providerReference !== claimReference) return { payment: existing, callProvider: false } as const;
      return { payment: existing, callProvider: true } as const;
    }

    const currentBooking = await transaction.hospitalityBooking.findFirst({
      where: { id: booking.id, organizationId: input.organizationId },
      select: { status: true, paymentStatus: true, currency: true, totalMinor: true },
    });
    if (!currentBooking || currentBooking.status !== 'CONFIRMED' || currentBooking.paymentStatus !== 'AUTHORIZED' || currentBooking.currency !== booking.currency || currentBooking.totalMinor !== booking.totalMinor) {
      throw new PaymentConflictError('Booking changed before payment capture could be claimed.');
    }

    const currentAuthorization = await transaction.paymentTransaction.findFirst({
      where: {
        organizationId: input.organizationId,
        bookingId: booking.id,
        kind: 'AUTHORIZATION',
        status: 'SUCCEEDED',
        providerCode: STRIPE_PROVIDER_CODE,
        providerReference: authorization.providerReference,
      },
      select: { id: true },
    });
    if (!currentAuthorization) throw new PaymentConflictError('Stripe authorization is no longer available to capture.');

    const blockingCapture = await transaction.paymentTransaction.findFirst({
      where: {
        organizationId: input.organizationId,
        bookingId: booking.id,
        providerCode: STRIPE_PROVIDER_CODE,
        kind: 'CAPTURE',
        status: { in: ['PENDING', 'SUCCEEDED'] },
      },
      select: { id: true },
    });
    if (blockingCapture) throw new PaymentConflictError('Stripe authorization already has an active or successful capture attempt.');

    const payment = await transaction.paymentTransaction.create({
      data: {
        organizationId: input.organizationId,
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
    return { payment, callProvider: true } as const;
  }, { isolationLevel: 'Serializable' });

  if (!claim.callProvider) return claim.payment;

  let providerResult: ProviderPaymentResult;
  try {
    providerResult = await stripe.provider.capturePayment({
      organizationId: input.organizationId,
      bookingId: booking.id,
      idempotencyKey,
      money: { currency: booking.currency, amountMinor: booking.totalMinor },
      providerReference: authorization.providerReference,
    });
  } catch (error) {
    if (error instanceof PaymentProviderError && !error.retryable) {
      await markProviderClaimFailed({ organizationId: input.organizationId, actorUserId: input.actorUserId, bookingId: booking.id, paymentId: claim.payment.id, kind: 'CAPTURE' });
    }
    throw error;
  }

  assertAuthoritativeProviderResult(providerResult, booking);
  if (providerResult.providerReference !== authorization.providerReference) {
    throw new PaymentConflictError('Stripe capture returned a different authorization reference.');
  }
  const persistence = stripeCapturePersistenceStatus(providerResult.status);

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(input.organizationId, 'idempotency', idempotencyKey)}, 0))`;
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(input.organizationId, 'booking', booking.id)}, 0))`;

    const existing = await transaction.paymentTransaction.findUnique({
      where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey } },
    });
    if (!existing) throw new PaymentConflictError('Stripe capture claim disappeared before persistence.');
    assertExactExistingOperation(existing, {
      bookingId: booking.id,
      kind: 'CAPTURE',
      currency: booking.currency,
      amountMinor: booking.totalMinor,
      requestFingerprint,
      providerReference: existing.providerReference === claimReference ? undefined : authorization.providerReference,
    });
    if (existing.providerReference !== claimReference) return existing;

    const currentBooking = await transaction.hospitalityBooking.findFirst({
      where: { id: booking.id, organizationId: input.organizationId },
      select: { status: true, paymentStatus: true, currency: true, totalMinor: true },
    });
    if (!currentBooking || currentBooking.status !== 'CONFIRMED' || currentBooking.paymentStatus !== 'AUTHORIZED' || currentBooking.currency !== booking.currency || currentBooking.totalMinor !== booking.totalMinor) {
      throw new PaymentConflictError('Booking changed while payment capture was being processed.');
    }

    const payment = await transaction.paymentTransaction.update({
      where: { id: existing.id },
      data: { status: persistence.transactionStatus, providerReference: authorization.providerReference },
    });
    if (persistence.bookingPaymentStatus === 'PAID') {
      await transaction.hospitalityBooking.update({ where: { id: booking.id }, data: { paymentStatus: 'PAID' } });
    }
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'payment.capture-recorded',
        resourceType: 'payment-transaction',
        resourceId: payment.id,
        afterData: {
          bookingId: booking.id,
          providerCode: STRIPE_PROVIDER_CODE,
          kind: payment.kind,
          status: payment.status,
          currency: payment.currency,
          amountMinor: payment.amountMinor.toString(),
          bookingPaymentStatus: persistence.bookingPaymentStatus,
        },
      },
    });
    return payment;
  }, { isolationLevel: 'Serializable' });
}
