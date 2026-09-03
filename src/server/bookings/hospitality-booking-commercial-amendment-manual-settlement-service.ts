import { createHash } from 'node:crypto';

import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { ManualPaymentProvider, normalizeManualPaymentReference } from '../payments/manual-payment-provider.ts';
import {
  assertPaymentProviderCapability,
  normalizePaymentIdempotencyKey,
} from '../payments/payment-provider.ts';
import { deriveNextBookingRefundSource } from '../payments/payment-refund-allocation-domain.ts';
import { deriveBookingSettlementSummary } from '../payments/payment-settlement-domain.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  deriveHospitalityCommercialAmendmentExecutionDecision,
} from './booking-commercial-amendment-execution-domain.ts';
import { deriveHospitalityCommercialAmendmentSettlementState } from './booking-commercial-amendment-settlement-domain.ts';
import { hospitalityBookingMutationLockKey } from './hospitality-booking-mutation-lock.ts';
import {
  HospitalityBookingConflictError,
  HospitalityBookingUnavailableError,
} from './hospitality-booking-service.ts';

const MANUAL_PROVIDER_CODE = 'manual';
const manualProvider = new ManualPaymentProvider();

function lockKey(organizationId: string, scope: string, value: string) {
  return `payment:${organizationId}:${scope}:${value}`;
}

function requestFingerprint(input: {
  amendmentId: string;
  operation: 'ADDITIONAL_CHARGE' | 'REFUND';
  currency: string;
  amountMinor: bigint;
  sourceProviderReference: string | null;
  externalReference: string;
}) {
  return createHash('sha256').update([
    'commercial-amendment',
    MANUAL_PROVIDER_CODE,
    input.amendmentId,
    input.operation,
    input.currency,
    input.amountMinor.toString(),
    input.sourceProviderReference ?? '',
    input.externalReference,
  ].join('\u001f'), 'utf8').digest('hex');
}

function deriveDecision(input: {
  amendment: {
    id: string;
    status: 'PREPARED' | 'CANCELLED' | 'EXPIRED' | 'APPLIED';
    direction: 'ADDITIONAL_CHARGE' | 'REFUND';
    paymentProviderCode: string;
    currency: string;
    beforeTotalMinor: bigint;
    afterTotalMinor: bigint;
    deltaMinor: bigint;
    expiresAt: Date;
  };
  transactions: readonly {
    commercialAmendmentId: string | null;
    kind: 'OFFLINE_PAYMENT' | 'AUTHORIZATION' | 'CAPTURE' | 'REFUND';
    status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'AMBIGUOUS';
    providerCode: string;
    providerReference: string;
    sourceProviderReference: string | null;
    currency: string;
    amountMinor: bigint;
  }[];
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

function assertExistingManualAmendmentPayment(input: {
  existing: {
    bookingId: string;
    commercialAmendmentId: string | null;
    kind: string;
    status: string;
    providerCode: string;
    providerReference: string;
    sourceProviderReference: string | null;
    currency: string;
    amountMinor: bigint;
    requestFingerprint: string | null;
  };
  bookingId: string;
  amendmentId: string;
  direction: 'ADDITIONAL_CHARGE' | 'REFUND';
  currency: string;
  deltaMinor: bigint;
  externalReference: string;
}) {
  const expectedKind = input.direction === 'ADDITIONAL_CHARGE' ? 'OFFLINE_PAYMENT' : 'REFUND';
  if (
    input.existing.bookingId !== input.bookingId
    || input.existing.commercialAmendmentId !== input.amendmentId
    || input.existing.kind !== expectedKind
    || input.existing.status !== 'SUCCEEDED'
    || input.existing.providerCode !== MANUAL_PROVIDER_CODE
    || input.existing.providerReference !== input.externalReference
    || input.existing.currency !== input.currency
    || input.existing.amountMinor <= 0n
    || input.existing.amountMinor > (input.deltaMinor < 0n ? -input.deltaMinor : input.deltaMinor)
    || (input.direction === 'ADDITIONAL_CHARGE' && input.existing.sourceProviderReference !== null)
    || (input.direction === 'REFUND' && !input.existing.sourceProviderReference?.trim())
  ) {
    throw new HospitalityBookingConflictError(
      'Commercial amendment payment idempotency key was already used for a different operation.',
    );
  }
  const fingerprint = requestFingerprint({
    amendmentId: input.amendmentId,
    operation: input.direction,
    currency: input.existing.currency,
    amountMinor: input.existing.amountMinor,
    sourceProviderReference: input.existing.sourceProviderReference,
    externalReference: input.externalReference,
  });
  if (input.existing.requestFingerprint !== fingerprint) {
    throw new HospitalityBookingConflictError(
      'Commercial amendment payment idempotency evidence is inconsistent.',
    );
  }
}

function executionConflictMessage(
  decision: ReturnType<typeof deriveHospitalityCommercialAmendmentExecutionDecision>,
) {
  if ('reason' in decision) return decision.reason;
  if (decision.state === 'READY_TO_APPLY') {
    return 'Commercial amendment payment is already settled and ready to apply.';
  }
  return 'Commercial amendment payment cannot be executed in its current state.';
}

export async function recordManualHospitalityBookingCommercialAmendmentSettlement(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  amendmentId: string;
  idempotencyKey: unknown;
  externalReference: unknown;
  now?: Date;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  assertUuidIdentifier(input.amendmentId, 'amendmentId');
  const idempotencyKey = normalizePaymentIdempotencyKey(input.idempotencyKey);
  const externalReference = normalizeManualPaymentReference(input.externalReference);
  const now = input.now ?? new Date();

  await Promise.all([
    requireOrganizationPermission({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      permission: 'booking:manage',
    }),
    requireOrganizationPermission({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      permission: 'payment:manage',
    }),
  ]);

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey(input.organizationId, 'idempotency', idempotencyKey)}, 0))`;
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityBookingMutationLockKey({
      organizationId: input.organizationId,
      bookingId: input.bookingId,
    })}, 0))`;

    const amendment = await transaction.hospitalityBookingCommercialAmendment.findFirst({
      where: {
        id: input.amendmentId,
        organizationId: input.organizationId,
        bookingId: input.bookingId,
      },
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
    if (!amendment) {
      throw new HospitalityBookingUnavailableError(
        'Commercial amendment is not available in this organization.',
      );
    }
    if (amendment.paymentProviderCode !== MANUAL_PROVIDER_CODE) {
      throw new HospitalityBookingConflictError(
        'Commercial amendment is not assigned to the manual payment provider.',
      );
    }

    const existing = await transaction.paymentTransaction.findUnique({
      where: {
        organizationId_idempotencyKey: {
          organizationId: input.organizationId,
          idempotencyKey,
        },
      },
    });
    if (existing) {
      assertExistingManualAmendmentPayment({
        existing,
        bookingId: input.bookingId,
        amendmentId: amendment.id,
        direction: amendment.direction,
        currency: amendment.currency,
        deltaMinor: amendment.deltaMinor,
        externalReference,
      });
      return { payment: existing, idempotent: true as const };
    }

    const booking = await transaction.hospitalityBooking.findFirst({
      where: { id: input.bookingId, organizationId: input.organizationId },
      select: {
        id: true,
        status: true,
        paymentStatus: true,
        currency: true,
        totalMinor: true,
        updatedAt: true,
      },
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

    const ledger = await transaction.paymentTransaction.findMany({
      where: { organizationId: input.organizationId, bookingId: input.bookingId },
      select: {
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
    const execution = deriveDecision({ amendment, transactions: ledger, now });
    if (execution.decision.state !== 'EXECUTE' || execution.decision.providerCode !== MANUAL_PROVIDER_CODE) {
      throw new HospitalityBookingConflictError(executionConflictMessage(execution.decision));
    }

    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey(input.organizationId, 'manual-reference', externalReference)}, 0))`;
    const duplicateReference = await transaction.paymentTransaction.findFirst({
      where: {
        organizationId: input.organizationId,
        providerCode: MANUAL_PROVIDER_CODE,
        providerReference: externalReference,
      },
      select: { id: true },
    });
    if (duplicateReference) {
      throw new HospitalityBookingConflictError(
        'Manual payment or refund reference has already been recorded in this organization.',
      );
    }

    let payment;
    if (execution.decision.operation === 'ADDITIONAL_CHARGE') {
      assertPaymentProviderCapability(manualProvider, 'OFFLINE_RECORDING');
      if (!manualProvider.recordOfflinePayment) {
        throw new HospitalityBookingConflictError('Manual payment provider cannot record offline payments.');
      }
      const providerResult = await manualProvider.recordOfflinePayment({
        organizationId: input.organizationId,
        bookingId: booking.id,
        idempotencyKey,
        money: {
          currency: execution.decision.currency,
          amountMinor: execution.decision.amountMinor,
        },
        reference: externalReference,
      });
      if (
        providerResult.status !== 'PAID'
        || providerResult.providerCode !== MANUAL_PROVIDER_CODE
        || providerResult.providerReference !== externalReference
        || providerResult.money.currency !== execution.decision.currency
        || providerResult.money.amountMinor !== execution.decision.amountMinor
      ) {
        throw new HospitalityBookingConflictError(
          'Manual provider result does not match the commercial amendment charge.',
        );
      }
      const fingerprint = requestFingerprint({
        amendmentId: amendment.id,
        operation: amendment.direction,
        currency: providerResult.money.currency,
        amountMinor: providerResult.money.amountMinor,
        sourceProviderReference: null,
        externalReference,
      });
      payment = await transaction.paymentTransaction.create({
        data: {
          organizationId: input.organizationId,
          bookingId: booking.id,
          commercialAmendmentId: amendment.id,
          idempotencyKey,
          requestFingerprint: fingerprint,
          kind: 'OFFLINE_PAYMENT',
          status: 'SUCCEEDED',
          providerCode: MANUAL_PROVIDER_CODE,
          providerReference: providerResult.providerReference,
          currency: providerResult.money.currency,
          amountMinor: providerResult.money.amountMinor,
        },
      });
    } else {
      if (execution.decision.sourceKind !== 'OFFLINE_PAYMENT') {
        throw new HospitalityBookingConflictError(
          'Manual commercial amendment refund did not resolve to an offline payment source.',
        );
      }
      assertPaymentProviderCapability(manualProvider, 'OFFLINE_REFUND_RECORDING');
      if (!manualProvider.recordOfflineRefund) {
        throw new HospitalityBookingConflictError('Manual payment provider cannot record offline refunds.');
      }
      const providerResult = await manualProvider.recordOfflineRefund({
        organizationId: input.organizationId,
        bookingId: booking.id,
        idempotencyKey,
        money: {
          currency: execution.decision.currency,
          amountMinor: execution.decision.amountMinor,
        },
        paymentReference: execution.decision.sourceProviderReference,
        refundReference: externalReference,
      });
      if (
        providerResult.status !== 'REFUNDED'
        || providerResult.providerCode !== MANUAL_PROVIDER_CODE
        || providerResult.providerReference !== execution.decision.sourceProviderReference
        || providerResult.refundReference !== externalReference
        || providerResult.money.currency !== execution.decision.currency
        || providerResult.money.amountMinor !== execution.decision.amountMinor
      ) {
        throw new HospitalityBookingConflictError(
          'Manual provider result does not match the commercial amendment refund.',
        );
      }
      const fingerprint = requestFingerprint({
        amendmentId: amendment.id,
        operation: amendment.direction,
        currency: providerResult.money.currency,
        amountMinor: providerResult.money.amountMinor,
        sourceProviderReference: providerResult.providerReference,
        externalReference,
      });
      payment = await transaction.paymentTransaction.create({
        data: {
          organizationId: input.organizationId,
          bookingId: booking.id,
          commercialAmendmentId: amendment.id,
          idempotencyKey,
          requestFingerprint: fingerprint,
          kind: 'REFUND',
          status: 'SUCCEEDED',
          providerCode: MANUAL_PROVIDER_CODE,
          providerReference: providerResult.refundReference,
          sourceProviderReference: providerResult.providerReference,
          currency: providerResult.money.currency,
          amountMinor: providerResult.money.amountMinor,
        },
      });
    }

    const postLedger = [...ledger, {
      commercialAmendmentId: payment.commercialAmendmentId,
      kind: payment.kind,
      status: payment.status,
      providerCode: payment.providerCode,
      providerReference: payment.providerReference,
      sourceProviderReference: payment.sourceProviderReference,
      currency: payment.currency,
      amountMinor: payment.amountMinor,
    }];
    const postSettlement = deriveHospitalityCommercialAmendmentSettlementState({
      amendmentId: amendment.id,
      direction: amendment.direction,
      paymentProviderCode: amendment.paymentProviderCode,
      currency: amendment.currency,
      beforeTotalMinor: amendment.beforeTotalMinor,
      afterTotalMinor: amendment.afterTotalMinor,
      deltaMinor: amendment.deltaMinor,
      transactions: postLedger,
    });
    if (postSettlement.state === 'CONFLICT') {
      throw new HospitalityBookingConflictError(postSettlement.reason);
    }

    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: amendment.direction === 'ADDITIONAL_CHARGE'
          ? 'payment.commercial-amendment.offline-recorded'
          : 'payment.commercial-amendment.offline-refund-recorded',
        resourceType: 'payment-transaction',
        resourceId: payment.id,
        afterData: {
          bookingId: booking.id,
          commercialAmendmentId: amendment.id,
          providerCode: payment.providerCode,
          kind: payment.kind,
          status: payment.status,
          sourceProviderReference: payment.sourceProviderReference,
          currency: payment.currency,
          amountMinor: payment.amountMinor.toString(),
          amendmentSettlementState: postSettlement.state,
        },
      },
    });

    return { payment, idempotent: false as const, settlement: postSettlement };
  }, { isolationLevel: 'Serializable' });
}
