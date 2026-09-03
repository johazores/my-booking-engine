import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { loadStripePaymentIntegration } from '../integrations/stripe-integration.ts';
import {
  PaymentProviderError,
  assertPaymentProviderCapability,
  normalizePaymentIdempotencyKey,
  type ProviderRefundResult,
} from '../payments/payment-provider.ts';
import { deriveNextBookingRefundSource } from '../payments/payment-refund-allocation-domain.ts';
import { deriveBookingSettlementSummary } from '../payments/payment-settlement-domain.ts';
import { isInternalPaymentClaimReference } from '../payments/stripe-payment-service.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  deriveHospitalityCommercialAmendmentExecutionDecision,
} from './booking-commercial-amendment-execution-domain.ts';
import {
  deriveStripeCommercialAmendmentRefundClaim,
  reconcileStripeCommercialAmendmentRefundSnapshot,
  stripeCommercialAmendmentRefundFingerprint,
  stripeCommercialAmendmentRefundPersistenceStatus,
} from './booking-commercial-amendment-stripe-refund-domain.ts';
import { deriveHospitalityCommercialAmendmentSettlementState } from './booking-commercial-amendment-settlement-domain.ts';
import { hospitalityBookingMutationLockKey } from './hospitality-booking-mutation-lock.ts';
import {
  HospitalityBookingConflictError,
  HospitalityBookingUnavailableError,
} from './hospitality-booking-service.ts';

const STRIPE_PROVIDER_CODE = 'stripe';
const STRIPE_REFUND_REFERENCE = /^re_[A-Za-z0-9_]+$/;

type AmendmentSnapshot = Readonly<{
  id: string;
  status: 'PREPARED' | 'CANCELLED' | 'EXPIRED' | 'APPLIED';
  direction: 'ADDITIONAL_CHARGE' | 'REFUND';
  paymentProviderCode: string;
  currency: string;
  beforeTotalMinor: bigint;
  afterTotalMinor: bigint;
  deltaMinor: bigint;
  expiresAt: Date;
  bookingVersion: Date;
}>;

type SettlementTransaction = Readonly<{
  id?: string;
  commercialAmendmentId: string | null;
  kind: 'OFFLINE_PAYMENT' | 'AUTHORIZATION' | 'CAPTURE' | 'REFUND';
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'AMBIGUOUS';
  providerCode: string;
  providerReference: string;
  sourceProviderReference: string | null;
  currency: string;
  amountMinor: bigint;
}>;

function paymentLockKey(organizationId: string, bookingId: string) {
  return `payment:${organizationId}:booking:${bookingId}`;
}

function idempotencyLockKey(organizationId: string, idempotencyKey: string) {
  return `payment:${organizationId}:idempotency:${idempotencyKey}`;
}

function deriveExecution(input: {
  amendment: AmendmentSnapshot;
  transactions: readonly SettlementTransaction[];
  now: Date;
}) {
  const settlement = deriveHospitalityCommercialAmendmentSettlementState({
    amendmentId: input.amendment.id,
    direction: input.amendment.direction,
    paymentProviderCode: input.amendment.paymentProviderCode,
    currency: input.amendment.currency,
    beforeTotalMinor: input.amendment.beforeTotalMinor,
    afterTotalMinor: input.amendment.afterTotalMinor,
    deltaMinor: input.amendment.deltaMinor,
    transactions: input.transactions,
  });

  let refundAllocation = null;
  if (input.amendment.direction === 'REFUND' && settlement.state === 'REQUIRES_EXECUTION') {
    const bookingSettlement = deriveBookingSettlementSummary({
      currency: input.amendment.currency,
      transactions: input.transactions,
    });
    refundAllocation = bookingSettlement.reconciled
      ? deriveNextBookingRefundSource({ sources: bookingSettlement.sources })
      : { allocated: false as const, reason: bookingSettlement.reason };
  }

  return {
    settlement,
    decision: deriveHospitalityCommercialAmendmentExecutionDecision({
      status: input.amendment.status,
      direction: input.amendment.direction,
      paymentProviderCode: input.amendment.paymentProviderCode,
      currency: input.amendment.currency,
      expiresAt: input.amendment.expiresAt,
      now: input.now,
      settlement,
      refundAllocation,
    }),
  };
}

function executionConflictMessage(
  decision: ReturnType<typeof deriveHospitalityCommercialAmendmentExecutionDecision>,
) {
  if ('reason' in decision) return decision.reason;
  if (decision.state === 'READY_TO_APPLY') return 'Commercial amendment payment is already settled and ready to apply.';
  return 'Commercial amendment payment cannot be executed in its current state.';
}

function assertStripeRefundAmendment(amendment: AmendmentSnapshot) {
  if (amendment.paymentProviderCode !== STRIPE_PROVIDER_CODE) {
    throw new HospitalityBookingConflictError('Commercial amendment is not assigned to Stripe.');
  }
  if (amendment.direction !== 'REFUND') {
    throw new HospitalityBookingConflictError(
      'Stripe commercial amendment additional charges require a new customer payment authorization and cannot reuse prior settlement credentials.',
    );
  }
}

function assertExistingClaim(input: {
  existing: {
    bookingId: string;
    commercialAmendmentId: string | null;
    kind: string;
    providerCode: string;
    providerReference: string;
    sourceProviderReference: string | null;
    currency: string;
    amountMinor: bigint;
    requestFingerprint: string | null;
  };
  bookingId: string;
  amendmentId: string;
}) {
  if (
    input.existing.bookingId !== input.bookingId
    || input.existing.commercialAmendmentId !== input.amendmentId
    || input.existing.kind !== 'REFUND'
    || input.existing.providerCode !== STRIPE_PROVIDER_CODE
    || !input.existing.sourceProviderReference
  ) {
    throw new HospitalityBookingConflictError(
      'Commercial amendment payment idempotency key was already used for a different operation.',
    );
  }

  const requestFingerprint = stripeCommercialAmendmentRefundFingerprint({
    bookingId: input.bookingId,
    amendmentId: input.amendmentId,
    currency: input.existing.currency,
    amountMinor: input.existing.amountMinor,
    sourceProviderReference: input.existing.sourceProviderReference,
  });
  if (input.existing.requestFingerprint !== requestFingerprint) {
    throw new HospitalityBookingConflictError('Commercial amendment Stripe refund idempotency evidence is inconsistent.');
  }
  return {
    requestFingerprint,
    claimReference: `sf_claim_${requestFingerprint}`,
    amountMinor: input.existing.amountMinor,
    sourceProviderReference: input.existing.sourceProviderReference,
  };
}

async function markStripeAmendmentRefundClaimFailed(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  amendmentId: string;
  paymentId: string;
}) {
  await db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityBookingMutationLockKey({
      organizationId: input.organizationId,
      bookingId: input.bookingId,
    })}, 0))`;
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(input.organizationId, input.bookingId)}, 0))`;

    const payment = await transaction.paymentTransaction.findFirst({
      where: {
        id: input.paymentId,
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        commercialAmendmentId: input.amendmentId,
        providerCode: STRIPE_PROVIDER_CODE,
        kind: 'REFUND',
      },
    });
    if (!payment || payment.status !== 'AMBIGUOUS' || !isInternalPaymentClaimReference(payment.providerReference)) return;

    const updated = await transaction.paymentTransaction.update({
      where: { id: payment.id },
      data: { status: 'FAILED' },
    });
    await transaction.auditEvent.create({ data: {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: 'payment.commercial-amendment.stripe-refund-failed',
      resourceType: 'payment-transaction',
      resourceId: updated.id,
      afterData: {
        bookingId: input.bookingId,
        commercialAmendmentId: input.amendmentId,
        providerCode: STRIPE_PROVIDER_CODE,
        kind: 'REFUND',
        status: 'FAILED',
        sourceProviderReference: updated.sourceProviderReference,
        currency: updated.currency,
        amountMinor: updated.amountMinor.toString(),
      },
    } });
  }, { isolationLevel: 'Serializable' });
}

export async function refundStripeHospitalityBookingCommercialAmendment(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  amendmentId: string;
  idempotencyKey: unknown;
  now?: Date;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  assertUuidIdentifier(input.amendmentId, 'amendmentId');
  const idempotencyKey = normalizePaymentIdempotencyKey(input.idempotencyKey);
  const now = input.now ?? new Date();

  await Promise.all([
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'booking:manage' }),
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'payment:manage' }),
  ]);

  const stripe = await loadStripePaymentIntegration(input.organizationId);
  if (!stripe.integration.capabilities.includes('payment-refund')) {
    throw new HospitalityBookingConflictError('Stripe integration is not configured for payment-refund.');
  }
  assertPaymentProviderCapability(stripe.provider, 'REFUND');
  if (!stripe.provider.refundPayment) {
    throw new HospitalityBookingConflictError('Stripe integration cannot refund payments.');
  }

  const claim = await db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${idempotencyLockKey(input.organizationId, idempotencyKey)}, 0))`;
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityBookingMutationLockKey({
      organizationId: input.organizationId,
      bookingId: input.bookingId,
    })}, 0))`;
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(input.organizationId, input.bookingId)}, 0))`;

    const amendment = await transaction.hospitalityBookingCommercialAmendment.findFirst({
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
    assertStripeRefundAmendment(amendment);

    const booking = await transaction.hospitalityBooking.findFirst({
      where: { id: input.bookingId, organizationId: input.organizationId },
      select: { id: true, status: true, paymentStatus: true, currency: true, totalMinor: true, updatedAt: true },
    });
    if (!booking) throw new HospitalityBookingUnavailableError();
    if (
      booking.status !== 'CONFIRMED'
      || booking.paymentStatus !== 'PAID'
      || booking.currency !== amendment.currency
      || booking.totalMinor !== amendment.beforeTotalMinor
      || booking.updatedAt.getTime() !== amendment.bookingVersion.getTime()
    ) {
      throw new HospitalityBookingConflictError(
        'Booking changed after this commercial amendment was prepared. Reconcile the booking and amendment before moving adjustment money.',
      );
    }

    const existing = await transaction.paymentTransaction.findUnique({
      where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey } },
    });
    const ledger = await transaction.paymentTransaction.findMany({
      where: { organizationId: input.organizationId, bookingId: input.bookingId },
      select: {
        id: true,
        commercialAmendmentId: true,
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

    if (existing) {
      const expectedClaim = assertExistingClaim({ existing, bookingId: booking.id, amendmentId: amendment.id });
      if (existing.status !== 'AMBIGUOUS') {
        return { payment: existing, callProvider: false as const, needsReconciliation: false as const };
      }
      if (!isInternalPaymentClaimReference(existing.providerReference)) {
        if (!STRIPE_REFUND_REFERENCE.test(existing.providerReference)) {
          throw new HospitalityBookingConflictError('Pending commercial amendment Stripe refund has an invalid provider reference.');
        }
        return { payment: existing, callProvider: false as const, needsReconciliation: true as const };
      }
      if (existing.providerReference !== expectedClaim.claimReference) {
        throw new HospitalityBookingConflictError('Commercial amendment Stripe refund claim reference is inconsistent.');
      }

      const execution = deriveExecution({
        amendment,
        transactions: ledger.filter((entry) => entry.id !== existing.id),
        now,
      });
      if (
        execution.decision.state !== 'EXECUTE'
        || execution.decision.operation !== 'REFUND'
        || execution.decision.providerCode !== STRIPE_PROVIDER_CODE
      ) {
        throw new HospitalityBookingConflictError(executionConflictMessage(execution.decision));
      }
      const currentClaim = deriveStripeCommercialAmendmentRefundClaim({
        bookingId: booking.id,
        amendmentId: amendment.id,
        decision: execution.decision,
      });
      if (
        currentClaim.requestFingerprint !== expectedClaim.requestFingerprint
        || currentClaim.amountMinor !== existing.amountMinor
        || currentClaim.sourceProviderReference !== existing.sourceProviderReference
      ) {
        throw new HospitalityBookingConflictError('Commercial amendment Stripe refund retry no longer matches authoritative settlement allocation.');
      }
      return {
        payment: existing,
        callProvider: true as const,
        needsReconciliation: false as const,
        claim: currentClaim,
      };
    }

    const execution = deriveExecution({ amendment, transactions: ledger, now });
    if (
      execution.decision.state !== 'EXECUTE'
      || execution.decision.operation !== 'REFUND'
      || execution.decision.providerCode !== STRIPE_PROVIDER_CODE
    ) {
      throw new HospitalityBookingConflictError(executionConflictMessage(execution.decision));
    }
    const stripeClaim = deriveStripeCommercialAmendmentRefundClaim({
      bookingId: booking.id,
      amendmentId: amendment.id,
      decision: execution.decision,
    });
    const payment = await transaction.paymentTransaction.create({ data: {
      organizationId: input.organizationId,
      bookingId: booking.id,
      commercialAmendmentId: amendment.id,
      idempotencyKey,
      requestFingerprint: stripeClaim.requestFingerprint,
      kind: 'REFUND',
      status: 'AMBIGUOUS',
      providerCode: STRIPE_PROVIDER_CODE,
      providerReference: stripeClaim.claimReference,
      sourceProviderReference: stripeClaim.sourceProviderReference,
      currency: stripeClaim.currency,
      amountMinor: stripeClaim.amountMinor,
    } });
    await transaction.auditEvent.create({ data: {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: 'payment.commercial-amendment.stripe-refund-claimed',
      resourceType: 'payment-transaction',
      resourceId: payment.id,
      afterData: {
        bookingId: booking.id,
        commercialAmendmentId: amendment.id,
        providerCode: STRIPE_PROVIDER_CODE,
        kind: 'REFUND',
        status: 'AMBIGUOUS',
        sourceProviderReference: stripeClaim.sourceProviderReference,
        currency: stripeClaim.currency,
        amountMinor: stripeClaim.amountMinor.toString(),
      },
    } });
    return {
      payment,
      callProvider: true as const,
      needsReconciliation: false as const,
      claim: stripeClaim,
    };
  }, { isolationLevel: 'Serializable' });

  if (!claim.callProvider) {
    return { payment: claim.payment, idempotent: true as const, needsReconciliation: claim.needsReconciliation };
  }

  let providerResult: ProviderRefundResult;
  try {
    providerResult = await stripe.provider.refundPayment({
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      idempotencyKey,
      money: { currency: claim.claim.currency, amountMinor: claim.claim.amountMinor },
      providerReference: claim.claim.sourceProviderReference,
    });
  } catch (error) {
    if (error instanceof PaymentProviderError && !error.retryable) {
      await markStripeAmendmentRefundClaimFailed({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        bookingId: input.bookingId,
        amendmentId: input.amendmentId,
        paymentId: claim.payment.id,
      });
    }
    throw error;
  }

  if (
    providerResult.providerCode !== STRIPE_PROVIDER_CODE
    || providerResult.providerReference !== claim.claim.sourceProviderReference
    || providerResult.money.currency !== claim.claim.currency
    || providerResult.money.amountMinor !== claim.claim.amountMinor
    || !STRIPE_REFUND_REFERENCE.test(providerResult.refundReference)
  ) {
    throw new HospitalityBookingConflictError('Stripe returned a refund result that does not match the commercial amendment claim.');
  }
  const persistedStatus = stripeCommercialAmendmentRefundPersistenceStatus(providerResult.status);

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${idempotencyLockKey(input.organizationId, idempotencyKey)}, 0))`;
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityBookingMutationLockKey({
      organizationId: input.organizationId,
      bookingId: input.bookingId,
    })}, 0))`;
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(input.organizationId, input.bookingId)}, 0))`;

    const current = await transaction.paymentTransaction.findFirst({
      where: {
        id: claim.payment.id,
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        commercialAmendmentId: input.amendmentId,
        providerCode: STRIPE_PROVIDER_CODE,
        kind: 'REFUND',
      },
    });
    if (!current) throw new HospitalityBookingUnavailableError('Commercial amendment Stripe refund claim is unavailable.');
    if (current.providerReference !== claim.claim.claimReference) {
      return { payment: current, idempotent: true as const, needsReconciliation: current.status === 'AMBIGUOUS' };
    }
    if (
      current.requestFingerprint !== claim.claim.requestFingerprint
      || current.sourceProviderReference !== claim.claim.sourceProviderReference
      || current.currency !== claim.claim.currency
      || current.amountMinor !== claim.claim.amountMinor
    ) {
      throw new HospitalityBookingConflictError('Commercial amendment Stripe refund claim changed while Stripe was processing it.');
    }

    const duplicateReference = await transaction.paymentTransaction.findFirst({
      where: {
        organizationId: input.organizationId,
        providerCode: STRIPE_PROVIDER_CODE,
        providerReference: providerResult.refundReference,
        id: { not: current.id },
      },
      select: { id: true },
    });
    if (duplicateReference) throw new HospitalityBookingConflictError('Stripe refund reference is already recorded in this organization.');

    const payment = await transaction.paymentTransaction.update({
      where: { id: current.id },
      data: { providerReference: providerResult.refundReference, status: persistedStatus },
    });
    await transaction.auditEvent.create({ data: {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: persistedStatus === 'SUCCEEDED'
        ? 'payment.commercial-amendment.stripe-refund-recorded'
        : persistedStatus === 'FAILED'
          ? 'payment.commercial-amendment.stripe-refund-failed'
          : 'payment.commercial-amendment.stripe-refund-ambiguous',
      resourceType: 'payment-transaction',
      resourceId: payment.id,
      afterData: {
        bookingId: input.bookingId,
        commercialAmendmentId: input.amendmentId,
        providerCode: STRIPE_PROVIDER_CODE,
        kind: 'REFUND',
        status: payment.status,
        sourceProviderReference: payment.sourceProviderReference,
        currency: payment.currency,
        amountMinor: payment.amountMinor.toString(),
        bookingPaymentStatePreservedUntilApply: true,
      },
    } });
    return { payment, idempotent: false as const, needsReconciliation: payment.status === 'AMBIGUOUS' };
  }, { isolationLevel: 'Serializable' });
}

export async function reconcileStripeHospitalityBookingCommercialAmendmentRefund(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  amendmentId: string;
  transactionId: string;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  assertUuidIdentifier(input.amendmentId, 'amendmentId');
  assertUuidIdentifier(input.transactionId, 'transactionId');

  await Promise.all([
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'booking:manage' }),
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'payment:manage' }),
  ]);

  const payment = await db.paymentTransaction.findFirst({
    where: {
      id: input.transactionId,
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      commercialAmendmentId: input.amendmentId,
      providerCode: STRIPE_PROVIDER_CODE,
      kind: 'REFUND',
    },
  });
  if (!payment) throw new HospitalityBookingUnavailableError('Commercial amendment Stripe refund is unavailable in this organization.');
  if (payment.status !== 'AMBIGUOUS') return payment;
  if (isInternalPaymentClaimReference(payment.providerReference)) {
    throw new HospitalityBookingConflictError(
      'Commercial amendment Stripe refund has no provider reference yet. Retry the exact idempotent operation to recover provider truth.',
    );
  }
  if (!STRIPE_REFUND_REFERENCE.test(payment.providerReference) || !payment.sourceProviderReference) {
    throw new HospitalityBookingConflictError('Commercial amendment Stripe refund provider evidence is invalid.');
  }

  const amendment = await db.hospitalityBookingCommercialAmendment.findFirst({
    where: { id: input.amendmentId, organizationId: input.organizationId, bookingId: input.bookingId },
    select: {
      id: true,
      direction: true,
      paymentProviderCode: true,
      currency: true,
      deltaMinor: true,
    },
  });
  if (!amendment) throw new HospitalityBookingUnavailableError('Commercial amendment is unavailable in this organization.');
  if (amendment.direction !== 'REFUND' || amendment.paymentProviderCode !== STRIPE_PROVIDER_CODE || amendment.currency !== payment.currency) {
    throw new HospitalityBookingConflictError('Commercial amendment no longer matches the Stripe refund being reconciled.');
  }
  const absoluteDelta = amendment.deltaMinor < 0n ? -amendment.deltaMinor : amendment.deltaMinor;
  if (payment.amountMinor <= 0n || payment.amountMinor > absoluteDelta) {
    throw new HospitalityBookingConflictError('Commercial amendment Stripe refund amount is outside the prepared adjustment.');
  }
  assertExistingClaim({ existing: payment, bookingId: input.bookingId, amendmentId: input.amendmentId });

  const stripe = await loadStripePaymentIntegration(input.organizationId);
  if (!stripe.integration.capabilities.includes('payment-refund')) {
    throw new HospitalityBookingConflictError('Stripe integration is not configured for payment-refund.');
  }
  const snapshot = await stripe.refundReconciliationProvider.retrieveRefund(payment.providerReference);
  if (snapshot.refundReference !== payment.providerReference) {
    throw new HospitalityBookingConflictError('Stripe refund reconciliation returned a different provider reference.');
  }

  let reconciledStatus: 'SUCCEEDED' | 'AMBIGUOUS' | 'FAILED';
  try {
    reconciledStatus = reconcileStripeCommercialAmendmentRefundSnapshot({
      currency: payment.currency,
      amountMinor: payment.amountMinor,
      sourceProviderReference: payment.sourceProviderReference,
      snapshot,
    });
  } catch (error) {
    throw new HospitalityBookingConflictError(error instanceof Error ? error.message : 'Stripe refund reconciliation evidence is invalid.');
  }

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityBookingMutationLockKey({
      organizationId: input.organizationId,
      bookingId: input.bookingId,
    })}, 0))`;
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(input.organizationId, input.bookingId)}, 0))`;

    const current = await transaction.paymentTransaction.findFirst({
      where: {
        id: payment.id,
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        commercialAmendmentId: input.amendmentId,
        providerCode: STRIPE_PROVIDER_CODE,
        kind: 'REFUND',
      },
    });
    if (!current) throw new HospitalityBookingUnavailableError('Commercial amendment Stripe refund is unavailable in this organization.');
    if (current.status !== 'AMBIGUOUS') return current;
    if (
      current.providerReference !== payment.providerReference
      || current.sourceProviderReference !== payment.sourceProviderReference
      || current.currency !== payment.currency
      || current.amountMinor !== payment.amountMinor
      || current.requestFingerprint !== payment.requestFingerprint
    ) {
      throw new HospitalityBookingConflictError('Commercial amendment Stripe refund changed during reconciliation.');
    }

    const updated = await transaction.paymentTransaction.update({
      where: { id: current.id },
      data: { status: reconciledStatus },
    });
    await transaction.auditEvent.create({ data: {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: 'payment.commercial-amendment.stripe-refund-reconciled',
      resourceType: 'payment-transaction',
      resourceId: updated.id,
      afterData: {
        bookingId: input.bookingId,
        commercialAmendmentId: input.amendmentId,
        providerCode: STRIPE_PROVIDER_CODE,
        kind: 'REFUND',
        status: updated.status,
        providerStatus: snapshot.status,
        sourceProviderReference: updated.sourceProviderReference,
        currency: updated.currency,
        amountMinor: updated.amountMinor.toString(),
        bookingPaymentStatePreservedUntilApply: true,
      },
    } });
    return updated;
  }, { isolationLevel: 'Serializable' });
}
