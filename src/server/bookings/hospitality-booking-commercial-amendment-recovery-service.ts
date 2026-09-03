import { createHash } from 'node:crypto';

import type { Prisma } from '../../generated/prisma/client.ts';
import { releaseHospitalityAvailabilityHoldInTransaction } from '../availability/hospitality-availability-hold-core.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { ManualPaymentProvider, normalizeManualPaymentReference } from '../payments/manual-payment-provider.ts';
import {
  assertPaymentProviderCapability,
  normalizePaymentIdempotencyKey,
} from '../payments/payment-provider.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  deriveHospitalityCommercialAmendmentRecoveryDecision,
  type HospitalityCommercialAmendmentRecoveryDecision,
} from './booking-commercial-amendment-recovery-domain.ts';
import { hospitalityBookingMutationLockKey } from './hospitality-booking-mutation-lock.ts';
import {
  HospitalityBookingConflictError,
  HospitalityBookingUnavailableError,
} from './hospitality-booking-service.ts';

const MANUAL_PROVIDER_CODE = 'manual';
const manualProvider = new ManualPaymentProvider();

type RecoveryContext = Awaited<ReturnType<typeof loadRecoveryContext>>;

function lockKey(organizationId: string, scope: string, value: string) {
  return `payment:${organizationId}:${scope}:${value}`;
}

function recoveryFingerprint(input: {
  amendmentId: string;
  operation: 'ADDITIONAL_CHARGE' | 'REFUND';
  currency: string;
  amountMinor: bigint;
  sourceProviderReference: string | null;
  externalReference: string;
}) {
  return createHash('sha256').update([
    'commercial-amendment-recovery',
    MANUAL_PROVIDER_CODE,
    input.amendmentId,
    input.operation,
    input.currency,
    input.amountMinor.toString(),
    input.sourceProviderReference ?? '',
    input.externalReference,
  ].join('\u001f'), 'utf8').digest('hex');
}

async function requireRecoveryPermissions(input: { organizationId: string; actorUserId: string }) {
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
}

async function loadRecoveryContext(input: {
  transaction: Prisma.TransactionClient;
  organizationId: string;
  bookingId: string;
  amendmentId: string;
}) {
  const amendment = await input.transaction.hospitalityBookingCommercialAmendment.findFirst({
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
      createdAt: true,
      expiresAt: true,
      bookingVersion: true,
      targetHoldId: true,
    },
  });
  if (!amendment) {
    throw new HospitalityBookingUnavailableError(
      'Commercial amendment is not available in this organization.',
    );
  }

  const booking = await input.transaction.hospitalityBooking.findFirst({
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

  const transactions = await input.transaction.paymentTransaction.findMany({
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
      createdAt: true,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  return { amendment, booking, transactions };
}

function assertPreparedBookingSnapshot(context: RecoveryContext) {
  if (
    context.booking.status !== 'CONFIRMED'
    || context.booking.paymentStatus !== 'PAID'
    || context.booking.currency !== context.amendment.currency
    || context.booking.totalMinor !== context.amendment.beforeTotalMinor
    || context.booking.updatedAt.getTime() !== context.amendment.bookingVersion.getTime()
  ) {
    throw new HospitalityBookingConflictError(
      'Booking changed after this commercial amendment was prepared. Recovery requires operator reconciliation before more money can move.',
    );
  }
}

function deriveRecoveryDecision(context: RecoveryContext, now: Date) {
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
    transactions: context.transactions,
  });
}

function decisionConflictMessage(decision: HospitalityCommercialAmendmentRecoveryDecision) {
  if ('reason' in decision) return decision.reason;
  return 'Commercial amendment recovery cannot continue in its current state.';
}

function assertExistingManualRecoveryPayment(input: {
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
  externalReference: string;
}) {
  const operation = input.existing.kind === 'OFFLINE_PAYMENT'
    ? 'ADDITIONAL_CHARGE' as const
    : input.existing.kind === 'REFUND'
      ? 'REFUND' as const
      : null;
  if (
    !operation
    || input.existing.bookingId !== input.bookingId
    || input.existing.commercialAmendmentId !== input.amendmentId
    || input.existing.status !== 'SUCCEEDED'
    || input.existing.providerCode !== MANUAL_PROVIDER_CODE
    || input.existing.providerReference !== input.externalReference
    || input.existing.amountMinor <= 0n
    || (operation === 'ADDITIONAL_CHARGE' && input.existing.sourceProviderReference !== null)
    || (operation === 'REFUND' && !input.existing.sourceProviderReference?.trim())
  ) {
    throw new HospitalityBookingConflictError(
      'Commercial amendment recovery idempotency key was already used for a different payment operation.',
    );
  }
  const fingerprint = recoveryFingerprint({
    amendmentId: input.amendmentId,
    operation,
    currency: input.existing.currency,
    amountMinor: input.existing.amountMinor,
    sourceProviderReference: input.existing.sourceProviderReference,
    externalReference: input.externalReference,
  });
  if (fingerprint !== input.existing.requestFingerprint) {
    throw new HospitalityBookingConflictError(
      'Commercial amendment recovery idempotency evidence is inconsistent.',
    );
  }
}

async function finalizeRecoveryInTransaction(input: {
  transaction: Prisma.TransactionClient;
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  context: RecoveryContext;
  decision: HospitalityCommercialAmendmentRecoveryDecision;
  now: Date;
}) {
  if (input.decision.state !== 'READY_TO_EXPIRE') {
    throw new HospitalityBookingConflictError(decisionConflictMessage(input.decision));
  }
  assertPreparedBookingSnapshot(input.context);

  if (input.context.amendment.targetHoldId) {
    await releaseHospitalityAvailabilityHoldInTransaction({
      transaction: input.transaction,
      organizationId: input.organizationId,
      holdId: input.context.amendment.targetHoldId,
      now: input.now,
    });
  }

  const updated = await input.transaction.hospitalityBookingCommercialAmendment.updateMany({
    where: {
      id: input.context.amendment.id,
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      status: 'PREPARED',
    },
    data: { status: 'EXPIRED', endedAt: input.now },
  });
  if (updated.count !== 1) {
    throw new HospitalityBookingConflictError(
      'Commercial amendment recovery state changed before it could be closed.',
    );
  }

  await input.transaction.auditEvent.create({
    data: {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: 'booking.commercial-amendment.recovery-completed',
      resourceType: 'hospitality-booking-commercial-amendment',
      resourceId: input.context.amendment.id,
      afterData: {
        bookingId: input.bookingId,
        status: 'EXPIRED',
        currency: input.context.amendment.currency,
        restoredNetSettledMinor: input.decision.netSettledMinor.toString(),
        targetHoldId: input.context.amendment.targetHoldId,
      },
    },
  });

  return { status: 'EXPIRED' as const, recovered: true as const };
}

export async function readHospitalityBookingCommercialAmendmentRecovery(input: {
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
  await requireRecoveryPermissions(input);
  const now = input.now ?? new Date();

  return db.$transaction(async (transaction) => {
    const context = await loadRecoveryContext({ transaction, ...input });
    if (context.amendment.status === 'PREPARED') assertPreparedBookingSnapshot(context);
    return {
      amendmentId: context.amendment.id,
      bookingId: context.booking.id,
      decision: deriveRecoveryDecision(context, now),
    };
  }, { isolationLevel: 'Serializable' });
}

export async function finalizeHospitalityBookingCommercialAmendmentRecovery(input: {
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
  await requireRecoveryPermissions(input);
  const now = input.now ?? new Date();

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityBookingMutationLockKey({
      organizationId: input.organizationId,
      bookingId: input.bookingId,
    })}, 0))`;
    const context = await loadRecoveryContext({ transaction, ...input });
    if (context.amendment.status === 'EXPIRED') {
      return { status: 'EXPIRED' as const, recovered: false as const, idempotent: true as const };
    }
    const decision = deriveRecoveryDecision(context, now);
    const finalized = await finalizeRecoveryInTransaction({
      transaction,
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      bookingId: input.bookingId,
      context,
      decision,
      now,
    });
    return { ...finalized, idempotent: false as const };
  }, { isolationLevel: 'Serializable' });
}

export async function recordManualHospitalityBookingCommercialAmendmentRecovery(input: {
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
  await requireRecoveryPermissions(input);

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey(input.organizationId, 'idempotency', idempotencyKey)}, 0))`;
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityBookingMutationLockKey({
      organizationId: input.organizationId,
      bookingId: input.bookingId,
    })}, 0))`;

    let context = await loadRecoveryContext({ transaction, ...input });
    if (context.amendment.paymentProviderCode !== MANUAL_PROVIDER_CODE) {
      throw new HospitalityBookingConflictError(
        'Commercial amendment recovery is not assigned to the manual payment provider.',
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
      assertExistingManualRecoveryPayment({
        existing,
        bookingId: input.bookingId,
        amendmentId: input.amendmentId,
        externalReference,
      });
      if (context.amendment.status === 'EXPIRED') {
        return { payment: existing, idempotent: true as const, recovery: { status: 'EXPIRED' as const } };
      }
      assertPreparedBookingSnapshot(context);
      const decision = deriveRecoveryDecision(context, now);
      if (decision.state === 'READY_TO_EXPIRE') {
        const recovery = await finalizeRecoveryInTransaction({
          transaction,
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          bookingId: input.bookingId,
          context,
          decision,
          now,
        });
        return { payment: existing, idempotent: true as const, recovery };
      }
      return { payment: existing, idempotent: true as const, recovery: decision };
    }

    assertPreparedBookingSnapshot(context);
    const decision = deriveRecoveryDecision(context, now);
    if (
      decision.state !== 'COMPENSATE'
      || decision.providerCode !== MANUAL_PROVIDER_CODE
    ) {
      throw new HospitalityBookingConflictError(decisionConflictMessage(decision));
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
    if (decision.operation === 'ADDITIONAL_CHARGE') {
      assertPaymentProviderCapability(manualProvider, 'OFFLINE_RECORDING');
      if (!manualProvider.recordOfflinePayment) {
        throw new HospitalityBookingConflictError('Manual payment provider cannot record offline payments.');
      }
      const providerResult = await manualProvider.recordOfflinePayment({
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        idempotencyKey,
        money: { currency: decision.currency, amountMinor: decision.amountMinor },
        reference: externalReference,
      });
      if (
        providerResult.status !== 'PAID'
        || providerResult.providerCode !== MANUAL_PROVIDER_CODE
        || providerResult.providerReference !== externalReference
        || providerResult.money.currency !== decision.currency
        || providerResult.money.amountMinor !== decision.amountMinor
      ) {
        throw new HospitalityBookingConflictError(
          'Manual provider result does not match the commercial amendment recovery charge.',
        );
      }
      payment = await transaction.paymentTransaction.create({
        data: {
          organizationId: input.organizationId,
          bookingId: input.bookingId,
          commercialAmendmentId: input.amendmentId,
          idempotencyKey,
          requestFingerprint: recoveryFingerprint({
            amendmentId: input.amendmentId,
            operation: decision.operation,
            currency: decision.currency,
            amountMinor: decision.amountMinor,
            sourceProviderReference: null,
            externalReference,
          }),
          kind: 'OFFLINE_PAYMENT',
          status: 'SUCCEEDED',
          providerCode: MANUAL_PROVIDER_CODE,
          providerReference: providerResult.providerReference,
          currency: providerResult.money.currency,
          amountMinor: providerResult.money.amountMinor,
        },
      });
    } else {
      if (decision.sourceKind !== 'OFFLINE_PAYMENT') {
        throw new HospitalityBookingConflictError(
          'Manual commercial amendment recovery refund did not resolve to an offline payment created by the amendment.',
        );
      }
      assertPaymentProviderCapability(manualProvider, 'OFFLINE_REFUND_RECORDING');
      if (!manualProvider.recordOfflineRefund) {
        throw new HospitalityBookingConflictError('Manual payment provider cannot record offline refunds.');
      }
      const providerResult = await manualProvider.recordOfflineRefund({
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        idempotencyKey,
        money: { currency: decision.currency, amountMinor: decision.amountMinor },
        paymentReference: decision.sourceProviderReference,
        refundReference: externalReference,
      });
      if (
        providerResult.status !== 'REFUNDED'
        || providerResult.providerCode !== MANUAL_PROVIDER_CODE
        || providerResult.providerReference !== decision.sourceProviderReference
        || providerResult.refundReference !== externalReference
        || providerResult.money.currency !== decision.currency
        || providerResult.money.amountMinor !== decision.amountMinor
      ) {
        throw new HospitalityBookingConflictError(
          'Manual provider result does not match the commercial amendment recovery refund.',
        );
      }
      payment = await transaction.paymentTransaction.create({
        data: {
          organizationId: input.organizationId,
          bookingId: input.bookingId,
          commercialAmendmentId: input.amendmentId,
          idempotencyKey,
          requestFingerprint: recoveryFingerprint({
            amendmentId: input.amendmentId,
            operation: decision.operation,
            currency: decision.currency,
            amountMinor: decision.amountMinor,
            sourceProviderReference: providerResult.providerReference,
            externalReference,
          }),
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

    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: decision.operation === 'ADDITIONAL_CHARGE'
          ? 'payment.commercial-amendment.recovery-offline-recorded'
          : 'payment.commercial-amendment.recovery-offline-refund-recorded',
        resourceType: 'payment-transaction',
        resourceId: payment.id,
        afterData: {
          bookingId: input.bookingId,
          commercialAmendmentId: input.amendmentId,
          providerCode: payment.providerCode,
          kind: payment.kind,
          status: payment.status,
          sourceProviderReference: payment.sourceProviderReference,
          currency: payment.currency,
          amountMinor: payment.amountMinor.toString(),
        },
      },
    });

    context = {
      ...context,
      transactions: [...context.transactions, {
        id: payment.id,
        commercialAmendmentId: payment.commercialAmendmentId,
        idempotencyKey: payment.idempotencyKey,
        requestFingerprint: payment.requestFingerprint,
        kind: payment.kind,
        status: payment.status,
        providerCode: payment.providerCode,
        providerReference: payment.providerReference,
        sourceProviderReference: payment.sourceProviderReference,
        currency: payment.currency,
        amountMinor: payment.amountMinor,
        createdAt: payment.createdAt,
      }],
    };
    const postDecision = deriveRecoveryDecision(context, now);
    if (postDecision.state === 'CONFLICT' || postDecision.state === 'WAIT_FOR_PROVIDER') {
      throw new HospitalityBookingConflictError(decisionConflictMessage(postDecision));
    }
    if (postDecision.state === 'READY_TO_EXPIRE') {
      const recovery = await finalizeRecoveryInTransaction({
        transaction,
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        bookingId: input.bookingId,
        context,
        decision: postDecision,
        now,
      });
      return { payment, idempotent: false as const, recovery };
    }

    return { payment, idempotent: false as const, recovery: postDecision };
  }, { isolationLevel: 'Serializable' });
}
