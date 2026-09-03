import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { deriveNextBookingRefundSource } from '../payments/payment-refund-allocation-domain.ts';
import { deriveBookingSettlementSummary } from '../payments/payment-settlement-domain.ts';
import { isInternalPaymentClaimReference } from '../payments/stripe-payment-service.ts';
import { moneyMinorToMajorString } from '../pricing/money.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { deriveHospitalityCommercialAmendmentExecutionDecision } from './booking-commercial-amendment-execution-domain.ts';
import { deriveHospitalityCommercialAmendmentSettlementState } from './booking-commercial-amendment-settlement-domain.ts';
import { deriveHospitalityCommercialAmendmentTransportState } from './booking-commercial-amendment-transport-domain.ts';
import type { HospitalityBookingCommercialModificationInput } from './booking-commercial-modification-domain.ts';
import { applyHospitalityBookingCommercialAmendment } from './hospitality-booking-commercial-amendment-apply-service.ts';
import {
  cancelHospitalityBookingCommercialAmendment,
  prepareHospitalityBookingCommercialAmendment,
} from './hospitality-booking-commercial-amendment-service.ts';
import { recordManualHospitalityBookingCommercialAmendmentSettlement } from './hospitality-booking-commercial-amendment-manual-settlement-service.ts';
import {
  reconcileStripeHospitalityBookingCommercialAmendmentRefund,
  refundStripeHospitalityBookingCommercialAmendment,
} from './hospitality-booking-commercial-amendment-stripe-refund-service.ts';
import {
  HospitalityBookingConflictError,
  HospitalityBookingUnavailableError,
} from './hospitality-booking-service.ts';

const STRIPE_PROVIDER_CODE = 'stripe';

type SettlementTransaction = Readonly<{
  id: string;
  commercialAmendmentId: string | null;
  idempotencyKey: string;
  kind: 'OFFLINE_PAYMENT' | 'AUTHORIZATION' | 'CAPTURE' | 'REFUND';
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'AMBIGUOUS';
  providerCode: string;
  providerReference: string;
  sourceProviderReference: string | null;
  currency: string;
  amountMinor: bigint;
}>;

async function requireTransportPermissions(input: { organizationId: string; actorUserId: string }) {
  await Promise.all([
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'booking:manage' }),
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'payment:manage' }),
  ]);
}

function formatMoney(amountMinor: bigint, currency: string) {
  return `${currency} ${moneyMinorToMajorString(amountMinor, currency)}`;
}

function decisionReason(decision: ReturnType<typeof deriveHospitalityCommercialAmendmentExecutionDecision>) {
  if ('reason' in decision) return decision.reason;
  if (decision.state === 'READY_TO_APPLY') return 'Payment settlement matches the prepared commercial total and is ready for final apply.';
  if (decision.state === 'EXECUTE') {
    if (decision.providerCode === 'manual') {
      return decision.operation === 'REFUND'
        ? 'Complete the exact external refund first, then record its real reference in SF.'
        : 'Receive the exact external payment first, then record its real reference in SF.';
    }
    if (decision.operation === 'REFUND') return 'SF can execute the next source-scoped Stripe refund server-side.';
    return 'This additional charge requires fresh customer authorization through a Stripe-hosted payment flow before it can settle.';
  }
  return 'Commercial amendment state requires operator reconciliation.';
}

function presentTransport(input: {
  bookingId: string;
  amendment: {
    id: string;
    status: 'PREPARED' | 'CANCELLED' | 'EXPIRED' | 'APPLIED';
    direction: 'ADDITIONAL_CHARGE' | 'REFUND';
    paymentProviderCode: string;
    currency: string;
    deltaMinor: bigint;
    expiresAt: Date;
  };
  settlement: ReturnType<typeof deriveHospitalityCommercialAmendmentSettlementState>;
  decision: ReturnType<typeof deriveHospitalityCommercialAmendmentExecutionDecision>;
  now: Date;
}) {
  const state = deriveHospitalityCommercialAmendmentTransportState(input.decision);
  const executableAmount = input.decision.state === 'EXECUTE' ? input.decision.amountMinor : null;
  const sourceProviderReference = input.decision.state === 'EXECUTE'
    && input.decision.operation === 'REFUND'
    && input.decision.providerCode === 'manual'
    ? input.decision.sourceProviderReference
    : null;
  const refundableSourceCount = input.decision.state === 'EXECUTE' && input.decision.operation === 'REFUND'
    ? input.decision.refundableSourceCount
    : null;
  const settledAdjustmentMinor = 'settledAdjustmentMinor' in input.settlement
    ? input.settlement.settledAdjustmentMinor
    : null;
  const canCancel = input.amendment.status === 'PREPARED'
    && input.amendment.expiresAt.getTime() > input.now.getTime()
    && settledAdjustmentMinor === 0n
    && input.settlement.state !== 'IN_PROGRESS';

  return Object.freeze({
    bookingId: input.bookingId,
    amendmentId: input.amendment.id,
    amendmentStatus: input.amendment.status,
    direction: input.amendment.direction,
    providerCode: input.amendment.paymentProviderCode,
    currency: input.amendment.currency,
    deltaDisplay: formatMoney(input.amendment.deltaMinor < 0n ? -input.amendment.deltaMinor : input.amendment.deltaMinor, input.amendment.currency),
    expiresAt: input.amendment.expiresAt.toISOString(),
    state,
    reason: decisionReason(input.decision),
    operation: input.decision.state === 'EXECUTE' ? input.decision.operation : null,
    amountDisplay: executableAmount == null ? null : formatMoney(executableAmount, input.amendment.currency),
    sourceProviderReference,
    refundableSourceCount,
    canCancel,
    canApply: state === 'READY_TO_APPLY',
  });
}

export async function readHospitalityBookingCommercialAmendmentTransport(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  amendmentId: string;
  now?: Date;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  assertUuidIdentifier(input.amendmentId, 'amendmentId');
  await requireTransportPermissions(input);
  const now = input.now ?? new Date();

  return db.$transaction(async (transaction) => {
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
      },
    });
    if (!amendment) throw new HospitalityBookingUnavailableError('Commercial amendment is unavailable in this organization.');

    const transactions: SettlementTransaction[] = await transaction.paymentTransaction.findMany({
      where: { organizationId: input.organizationId, bookingId: input.bookingId },
      select: {
        id: true,
        commercialAmendmentId: true,
        idempotencyKey: true,
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
    const settlement = deriveHospitalityCommercialAmendmentSettlementState({
      amendmentId: amendment.id,
      direction: amendment.direction,
      paymentProviderCode: amendment.paymentProviderCode,
      currency: amendment.currency,
      beforeTotalMinor: amendment.beforeTotalMinor,
      afterTotalMinor: amendment.afterTotalMinor,
      deltaMinor: amendment.deltaMinor,
      transactions,
    });

    let refundAllocation = null;
    if (amendment.direction === 'REFUND' && settlement.state === 'REQUIRES_EXECUTION') {
      const bookingSettlement = deriveBookingSettlementSummary({ currency: amendment.currency, transactions });
      refundAllocation = bookingSettlement.reconciled
        ? deriveNextBookingRefundSource({ sources: bookingSettlement.sources })
        : { allocated: false as const, reason: bookingSettlement.reason };
    }
    const decision = deriveHospitalityCommercialAmendmentExecutionDecision({
      status: amendment.status,
      direction: amendment.direction,
      paymentProviderCode: amendment.paymentProviderCode,
      currency: amendment.currency,
      expiresAt: amendment.expiresAt,
      now,
      settlement,
      refundAllocation,
    });
    return presentTransport({ bookingId: input.bookingId, amendment, settlement, decision, now });
  }, { isolationLevel: 'Serializable' });
}

export async function findHospitalityBookingCommercialAmendmentTransport(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  now?: Date;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  await requireTransportPermissions(input);
  const now = input.now ?? new Date();
  const amendments = await db.hospitalityBookingCommercialAmendment.findMany({
    where: { organizationId: input.organizationId, bookingId: input.bookingId, status: 'PREPARED', expiresAt: { gt: now } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
    take: 2,
  });
  if (amendments.length === 0) return null;
  if (amendments.length > 1) {
    throw new HospitalityBookingConflictError('Booking has multiple active prepared commercial amendments and requires operator reconciliation.');
  }
  return readHospitalityBookingCommercialAmendmentTransport({ ...input, amendmentId: amendments[0]!.id, now });
}

export async function prepareHospitalityBookingCommercialAmendmentTransport(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  change: HospitalityBookingCommercialModificationInput;
  adjustmentFingerprint: unknown;
  now?: Date;
}) {
  const amendment = await prepareHospitalityBookingCommercialAmendment(input);
  return readHospitalityBookingCommercialAmendmentTransport({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    bookingId: input.bookingId,
    amendmentId: amendment.id,
    now: input.now,
  });
}

export async function recordManualHospitalityBookingCommercialAmendmentTransport(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  amendmentId: string;
  idempotencyKey: unknown;
  externalReference: unknown;
  now?: Date;
}) {
  await recordManualHospitalityBookingCommercialAmendmentSettlement(input);
  return readHospitalityBookingCommercialAmendmentTransport(input);
}

export async function executeStripeHospitalityBookingCommercialAmendmentRefundTransport(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  amendmentId: string;
  idempotencyKey: unknown;
  now?: Date;
}) {
  await refundStripeHospitalityBookingCommercialAmendment(input);
  return readHospitalityBookingCommercialAmendmentTransport(input);
}

export async function reconcileStripeHospitalityBookingCommercialAmendmentRefundTransport(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  amendmentId: string;
  now?: Date;
}) {
  const current = await readHospitalityBookingCommercialAmendmentTransport(input);
  if (current.providerCode !== STRIPE_PROVIDER_CODE || current.direction !== 'REFUND' || current.state !== 'WAIT_FOR_PROVIDER') return current;

  const unresolved = await db.paymentTransaction.findMany({
    where: {
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      commercialAmendmentId: input.amendmentId,
      providerCode: STRIPE_PROVIDER_CODE,
      kind: 'REFUND',
      status: 'AMBIGUOUS',
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, idempotencyKey: true, providerReference: true },
    take: 2,
  });
  if (unresolved.length !== 1) {
    throw new HospitalityBookingConflictError('Commercial amendment Stripe refund does not have exactly one unresolved provider operation to reconcile.');
  }
  const payment = unresolved[0]!;
  if (isInternalPaymentClaimReference(payment.providerReference)) {
    await refundStripeHospitalityBookingCommercialAmendment({ ...input, idempotencyKey: payment.idempotencyKey });
  } else {
    await reconcileStripeHospitalityBookingCommercialAmendmentRefund({ ...input, transactionId: payment.id });
  }
  return readHospitalityBookingCommercialAmendmentTransport(input);
}

export async function applyHospitalityBookingCommercialAmendmentTransport(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  amendmentId: string;
  now?: Date;
}) {
  await applyHospitalityBookingCommercialAmendment(input);
  return readHospitalityBookingCommercialAmendmentTransport(input);
}

export async function cancelHospitalityBookingCommercialAmendmentTransport(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  amendmentId: string;
  now?: Date;
}) {
  await cancelHospitalityBookingCommercialAmendment(input);
  return readHospitalityBookingCommercialAmendmentTransport(input);
}
