import type { Prisma } from '../../generated/prisma/client.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { loadStripeCheckoutIntegration } from '../integrations/stripe-checkout-integration.ts';
import { PaymentProviderError, normalizePaymentIdempotencyKey } from '../payments/payment-provider.ts';
import { PaymentConflictError } from '../payments/payment-service.ts';
import { isInternalPaymentClaimReference, paymentOperationClaimReference } from '../payments/stripe-payment-service.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { deriveHospitalityCommercialAmendmentExecutionDecision } from './booking-commercial-amendment-execution-domain.ts';
import {
  STRIPE_COMMERCIAL_AMENDMENT_CHECKOUT_IDEMPOTENCY_PREFIX,
  isStripeCommercialAmendmentCheckoutSessionReference,
  reconcileStripeCommercialAmendmentCheckoutSnapshot,
  stripeCommercialAmendmentCheckoutFingerprint,
  stripeCommercialAmendmentCheckoutIdempotencyKey,
  StripeCommercialAmendmentCheckoutConflictError,
} from './booking-commercial-amendment-stripe-checkout-domain.ts';
import { deriveHospitalityCommercialAmendmentSettlementState } from './booking-commercial-amendment-settlement-domain.ts';
import { hospitalityBookingMutationLockKey } from './hospitality-booking-mutation-lock.ts';
import {
  HospitalityBookingConflictError,
  HospitalityBookingUnavailableError,
} from './hospitality-booking-service.ts';

const STRIPE_PROVIDER_CODE = 'stripe';

type SettlementTransaction = Readonly<{
  id: string;
  commercialAmendmentId: string | null;
  idempotencyKey: string;
  requestFingerprint: string | null;
  kind: 'OFFLINE_PAYMENT' | 'AUTHORIZATION' | 'CAPTURE' | 'REFUND';
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'AMBIGUOUS';
  providerCode: string;
  providerReference: string;
  sourceProviderReference: string | null;
  currency: string;
  amountMinor: bigint;
}>;

type CheckoutContext = Awaited<ReturnType<typeof loadCheckoutContext>>;
type CheckoutPayment = CheckoutContext['transactions'][number];

function paymentLockKey(organizationId: string, bookingId: string) {
  return `payment:${organizationId}:booking:${bookingId}`;
}

function idempotencyLockKey(organizationId: string, idempotencyKey: string) {
  return `payment:${organizationId}:idempotency:${idempotencyKey}`;
}

async function requireCheckoutPermissions(input: { organizationId: string; actorUserId: string }) {
  await Promise.all([
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'booking:manage' }),
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'payment:manage' }),
  ]);
}

async function lockCheckoutWrite(input: {
  transaction: Prisma.TransactionClient;
  organizationId: string;
  bookingId: string;
  idempotencyKey?: string;
}) {
  await input.transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityBookingMutationLockKey({
    organizationId: input.organizationId,
    bookingId: input.bookingId,
  })}, 0))`;
  await input.transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(input.organizationId, input.bookingId)}, 0))`;
  if (input.idempotencyKey) {
    await input.transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${idempotencyLockKey(input.organizationId, input.idempotencyKey)}, 0))`;
  }
}

async function loadCheckoutContext(input: {
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

  const transactions: SettlementTransaction[] = await input.transaction.paymentTransaction.findMany({
    where: { organizationId: input.organizationId, bookingId: input.bookingId },
    select: {
      id: true,
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
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return { amendment, booking, transactions };
}

function assertCheckoutSnapshot(context: CheckoutContext) {
  const { amendment, booking } = context;
  if (
    amendment.status !== 'PREPARED'
    || amendment.direction !== 'ADDITIONAL_CHARGE'
    || amendment.paymentProviderCode !== STRIPE_PROVIDER_CODE
    || amendment.deltaMinor <= 0n
    || amendment.afterTotalMinor - amendment.beforeTotalMinor !== amendment.deltaMinor
    || booking.status !== 'CONFIRMED'
    || booking.paymentStatus !== 'PAID'
    || booking.currency !== amendment.currency
    || booking.totalMinor !== amendment.beforeTotalMinor
    || booking.updatedAt.getTime() !== amendment.bookingVersion.getTime()
  ) {
    throw new HospitalityBookingConflictError(
      'Booking or commercial amendment changed before customer-authorized Stripe settlement could complete.',
    );
  }
}

function deriveCheckoutExecution(context: CheckoutContext, now: Date, omittedTransactionId?: string) {
  const transactions = omittedTransactionId
    ? context.transactions.filter((transaction) => transaction.id !== omittedTransactionId)
    : context.transactions;
  const settlement = deriveHospitalityCommercialAmendmentSettlementState({
    amendmentId: context.amendment.id,
    direction: context.amendment.direction,
    paymentProviderCode: context.amendment.paymentProviderCode,
    currency: context.amendment.currency,
    beforeTotalMinor: context.amendment.beforeTotalMinor,
    afterTotalMinor: context.amendment.afterTotalMinor,
    deltaMinor: context.amendment.deltaMinor,
    transactions,
  });
  const decision = deriveHospitalityCommercialAmendmentExecutionDecision({
    status: context.amendment.status,
    direction: context.amendment.direction,
    paymentProviderCode: context.amendment.paymentProviderCode,
    currency: context.amendment.currency,
    expiresAt: context.amendment.expiresAt,
    now,
    settlement,
  });
  if (
    decision.state !== 'EXECUTE'
    || decision.operation !== 'ADDITIONAL_CHARGE'
    || decision.providerCode !== STRIPE_PROVIDER_CODE
    || decision.currency !== context.amendment.currency
    || decision.amountMinor <= 0n
  ) {
    const reason = 'reason' in decision ? decision.reason : 'Commercial amendment is not ready for customer-authorized Stripe Checkout.';
    throw new HospitalityBookingConflictError(reason);
  }
  return decision;
}

function assertExactCheckoutClaim(input: {
  payment: CheckoutPayment;
  bookingId: string;
  amendmentId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  currency: string;
  amountMinor: bigint;
}) {
  const payment = input.payment;
  if (
    payment.commercialAmendmentId !== input.amendmentId
    || payment.idempotencyKey !== input.idempotencyKey
    || payment.requestFingerprint !== input.requestFingerprint
    || payment.kind !== 'CAPTURE'
    || payment.providerCode !== STRIPE_PROVIDER_CODE
    || payment.currency !== input.currency
    || payment.amountMinor !== input.amountMinor
    || payment.sourceProviderReference !== null
  ) {
    throw new PaymentConflictError('Stripe commercial amendment Checkout request key was already used for a different operation.');
  }
  if (
    !isInternalPaymentClaimReference(payment.providerReference)
    && !isStripeCommercialAmendmentCheckoutSessionReference(payment.providerReference)
    && !/^pi_[A-Za-z0-9_]+$/.test(payment.providerReference)
  ) {
    throw new PaymentConflictError('Stripe commercial amendment Checkout payment reference is invalid.');
  }
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
    await lockCheckoutWrite({ transaction, organizationId: input.organizationId, bookingId: input.bookingId, idempotencyKey: input.idempotencyKey });
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
    await transaction.auditEvent.create({ data: {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: 'payment.commercial-amendment.stripe-checkout-failed',
      resourceType: 'payment-transaction',
      resourceId: updated.id,
      afterData: {
        bookingId: input.bookingId,
        commercialAmendmentId: input.amendmentId,
        providerCode: STRIPE_PROVIDER_CODE,
        kind: 'CAPTURE',
        status: 'FAILED',
        failureCode: input.failureCode,
        bookingPaymentStatePreservedUntilApplyOrRecovery: true,
      },
    } });
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
    await lockCheckoutWrite({ transaction, organizationId: input.organizationId, bookingId: input.bookingId, idempotencyKey: input.idempotencyKey });
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
      },
    });
    if (!payment) throw new PaymentConflictError('Stripe commercial amendment Checkout claim is no longer available.');
    assertExactCheckoutClaim({ ...input, payment });
    if (payment.status !== 'AMBIGUOUS') return payment;
    if (isStripeCommercialAmendmentCheckoutSessionReference(payment.providerReference)) {
      if (payment.providerReference !== input.sessionReference) {
        throw new PaymentConflictError('Stripe commercial amendment Checkout claim is already bound to a different Session.');
      }
      return payment;
    }
    if (!isInternalPaymentClaimReference(payment.providerReference)) {
      throw new PaymentConflictError('Stripe commercial amendment Checkout claim cannot be rebound after provider settlement.');
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

    const updated = await transaction.paymentTransaction.update({ where: { id: payment.id }, data: { providerReference: input.sessionReference } });
    await transaction.auditEvent.create({ data: {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: 'payment.commercial-amendment.stripe-checkout-created',
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
        amendmentExpiresAtMayPrecedeCheckout: true,
        currency: input.currency,
        amountMinor: input.amountMinor.toString(),
        bookingPaymentStatePreservedUntilApplyOrRecovery: true,
      },
    } });
    return updated;
  }, { isolationLevel: 'Serializable' });
}

export async function createStripeHospitalityBookingCommercialAmendmentCheckout(input: {
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
  const idempotencyKey = stripeCommercialAmendmentCheckoutIdempotencyKey({
    organizationId: input.organizationId,
    bookingId: input.bookingId,
    amendmentId: input.amendmentId,
    requestKey,
  });
  const now = input.now ?? new Date();
  await requireCheckoutPermissions(input);

  const action = await db.$transaction(async (transaction) => {
    await lockCheckoutWrite({ transaction, organizationId: input.organizationId, bookingId: input.bookingId, idempotencyKey });
    const context = await loadCheckoutContext({ transaction, ...input });
    assertCheckoutSnapshot(context);
    const existing = context.transactions.find((entry) => entry.idempotencyKey === idempotencyKey) ?? null;
    const decision = deriveCheckoutExecution(context, now, existing?.id);
    const requestFingerprint = stripeCommercialAmendmentCheckoutFingerprint({
      bookingId: input.bookingId,
      amendmentId: input.amendmentId,
      currency: decision.currency,
      amountMinor: decision.amountMinor,
    });
    const competing = context.transactions.find((entry) => (
      entry.id !== existing?.id
      && entry.commercialAmendmentId === input.amendmentId
      && (entry.status === 'PENDING' || entry.status === 'AMBIGUOUS')
    ));
    if (competing) {
      throw new PaymentConflictError('Commercial amendment already has an unresolved provider operation. Reconcile it before starting Checkout.');
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
        throw new PaymentConflictError('This Stripe commercial amendment Checkout attempt ended definitively. Start a fresh customer payment attempt.');
      }
      if (existing.status === 'SUCCEEDED') {
        return { kind: 'SETTLED' as const, payment: existing, decision, customerEmail: context.booking.customer.email };
      }
      return { kind: 'CHECKOUT' as const, payment: existing, decision, requestFingerprint, customerEmail: context.booking.customer.email };
    }

    const payment = await transaction.paymentTransaction.create({ data: {
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
    } });
    await transaction.auditEvent.create({ data: {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: 'payment.commercial-amendment.stripe-checkout-claimed',
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
        bookingPaymentStatePreservedUntilApplyOrRecovery: true,
      },
    } });
    return { kind: 'CHECKOUT' as const, payment, decision, requestFingerprint, customerEmail: context.booking.customer.email };
  }, { isolationLevel: 'Serializable' });

  if (action.kind === 'SETTLED') {
    return Object.freeze({ state: 'PAYMENT_CONFIRMED' as const, checkoutUrl: null, expiresAt: null, currency: action.decision.currency, amountMinor: action.decision.amountMinor });
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
      purpose: 'commercial-amendment-charge',
      idempotencyKey,
      money: { currency: action.decision.currency, amountMinor: action.decision.amountMinor },
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      customerEmail: action.customerEmail,
      now,
    });
    if (checkout.expiresAt.getTime() <= now.getTime()) {
      throw new PaymentConflictError('Stripe commercial amendment Checkout Session is already expired and requires provider reconciliation.');
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
    return Object.freeze({ state: 'CHECKOUT_REQUIRED' as const, checkoutUrl: checkout.checkoutUrl, expiresAt: checkout.expiresAt.toISOString(), currency: checkout.money.currency, amountMinor: checkout.money.amountMinor });
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

function assertReconciliationClaim(input: {
  context: CheckoutContext;
  payment: CheckoutPayment;
  bookingId: string;
  amendmentId: string;
}) {
  assertCheckoutSnapshot(input.context);
  const payment = input.payment;
  if (
    payment.commercialAmendmentId !== input.amendmentId
    || payment.kind !== 'CAPTURE'
    || payment.providerCode !== STRIPE_PROVIDER_CODE
    || !payment.idempotencyKey.startsWith(STRIPE_COMMERCIAL_AMENDMENT_CHECKOUT_IDEMPOTENCY_PREFIX)
    || payment.sourceProviderReference !== null
    || payment.currency !== input.context.amendment.currency
    || payment.amountMinor <= 0n
    || payment.amountMinor > input.context.amendment.deltaMinor
  ) {
    throw new HospitalityBookingConflictError('Stripe commercial amendment Checkout claim no longer matches the prepared adjustment.');
  }
  const expectedFingerprint = stripeCommercialAmendmentCheckoutFingerprint({
    bookingId: input.bookingId,
    amendmentId: input.amendmentId,
    currency: payment.currency,
    amountMinor: payment.amountMinor,
  });
  if (payment.requestFingerprint !== expectedFingerprint) {
    throw new PaymentConflictError('Stripe commercial amendment Checkout request fingerprint is inconsistent.');
  }
  if (payment.status === 'AMBIGUOUS' && !isStripeCommercialAmendmentCheckoutSessionReference(payment.providerReference)) {
    throw new PaymentConflictError('Stripe commercial amendment Checkout claim is missing its Checkout Session reference.');
  }
}

export async function reconcileStripeHospitalityBookingCommercialAmendmentCheckout(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  amendmentId: string;
  transactionId: string;
  now?: Date;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  assertUuidIdentifier(input.amendmentId, 'amendmentId');
  assertUuidIdentifier(input.transactionId, 'transactionId');
  await requireCheckoutPermissions(input);

  const context = await db.$transaction(async (transaction) => {
    const loaded = await loadCheckoutContext({ transaction, ...input });
    const payment = loaded.transactions.find((entry) => entry.id === input.transactionId) ?? null;
    if (!payment) throw new HospitalityBookingUnavailableError('Stripe commercial amendment Checkout transaction is unavailable in this organization.');
    if (payment.status === 'SUCCEEDED' || payment.status === 'FAILED') return { ...loaded, payment };
    if (payment.status !== 'AMBIGUOUS') throw new HospitalityBookingConflictError('Stripe commercial amendment Checkout transaction is not reconcilable.');
    assertReconciliationClaim({ context: loaded, payment, bookingId: input.bookingId, amendmentId: input.amendmentId });
    return { ...loaded, payment };
  }, { isolationLevel: 'Serializable' });

  if (context.payment.status === 'SUCCEEDED' || context.payment.status === 'FAILED') return context.payment;

  const stripe = await loadStripeCheckoutIntegration(input.organizationId);
  const snapshot = await stripe.provider.retrievePaymentSession(context.payment.providerReference);
  let reconciliation;
  try {
    reconciliation = reconcileStripeCommercialAmendmentCheckoutSnapshot({
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      amendmentId: input.amendmentId,
      checkoutReference: context.payment.providerReference,
      currency: context.payment.currency,
      amountMinor: context.payment.amountMinor,
      snapshot,
    });
  } catch (error) {
    throw new HospitalityBookingConflictError(
      error instanceof StripeCommercialAmendmentCheckoutConflictError
        ? error.message
        : 'Stripe commercial amendment Checkout provider truth is invalid.',
    );
  }

  return db.$transaction(async (transaction) => {
    await lockCheckoutWrite({ transaction, organizationId: input.organizationId, bookingId: input.bookingId });
    const loaded = await loadCheckoutContext({ transaction, ...input });
    const payment = loaded.transactions.find((entry) => entry.id === input.transactionId) ?? null;
    if (!payment) throw new HospitalityBookingUnavailableError('Stripe commercial amendment Checkout transaction is no longer available.');
    if (payment.status === 'SUCCEEDED' || payment.status === 'FAILED') return payment;
    assertReconciliationClaim({ context: loaded, payment, bookingId: input.bookingId, amendmentId: input.amendmentId });
    if (payment.providerReference !== reconciliation.checkoutReference) {
      throw new PaymentConflictError('Stripe commercial amendment Checkout Session changed during provider reconciliation.');
    }
    if (reconciliation.transactionStatus === 'AMBIGUOUS') return payment;

    if (reconciliation.transactionStatus === 'SUCCEEDED') {
      if (!reconciliation.paymentIntentReference) throw new PaymentConflictError('Paid Stripe commercial amendment Checkout is missing its PaymentIntent reference.');
      const duplicate = await transaction.paymentTransaction.findFirst({
        where: {
          organizationId: input.organizationId,
          providerCode: STRIPE_PROVIDER_CODE,
          providerReference: reconciliation.paymentIntentReference,
          id: { not: payment.id },
        },
        select: { id: true },
      });
      if (duplicate) throw new PaymentConflictError('Stripe commercial amendment Checkout PaymentIntent is already bound to another payment transaction.');
    }

    const updated = await transaction.paymentTransaction.update({
      where: { id: payment.id },
      data: {
        status: reconciliation.transactionStatus,
        providerReference: reconciliation.paymentIntentReference ?? payment.providerReference,
      },
    });
    await transaction.auditEvent.create({ data: {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: reconciliation.transactionStatus === 'SUCCEEDED'
        ? 'payment.commercial-amendment.stripe-checkout-paid'
        : 'payment.commercial-amendment.stripe-checkout-expired',
      resourceType: 'payment-transaction',
      resourceId: updated.id,
      afterData: {
        bookingId: input.bookingId,
        commercialAmendmentId: input.amendmentId,
        providerCode: STRIPE_PROVIDER_CODE,
        kind: 'CAPTURE',
        status: updated.status,
        checkoutSessionReference: reconciliation.checkoutReference,
        providerReference: updated.providerReference,
        currency: updated.currency,
        amountMinor: updated.amountMinor.toString(),
        bookingPaymentStatePreservedUntilApplyOrRecovery: true,
      },
    } });
    return updated;
  }, { isolationLevel: 'Serializable' });
}
