import type { Prisma } from '../../generated/prisma/client.ts';

import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { ManualPaymentProvider, normalizeManualPaymentReference } from '../payments/manual-payment-provider.ts';
import {
  assertPaymentProviderCapability,
  normalizePaymentMoney,
} from '../payments/payment-provider.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  buildRentalBookingEffectiveRefundIdempotencyKey,
  buildRentalBookingEffectiveRefundRequestFingerprint,
  deriveRentalBookingEffectiveRefundPlan,
} from './rental-booking-effective-refund-domain.ts';
import { readRentalBookingEffectiveSettlementInTransaction } from './rental-booking-effective-settlement-service.ts';
import { rentalBookingLockKey } from './rental-booking-reschedule-domain.ts';
import { classifyRentalBookingWriteError } from './rental-booking-write-errors.ts';

const manualProvider = new ManualPaymentProvider();
const manualReferenceLockKey = (organizationId: string, reference: string) =>
  `sf:rental-manual-reference:${organizationId}:${reference}`;

export class RentalBookingEffectiveRefundConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RentalBookingEffectiveRefundConflictError';
  }
}

async function runWrite<T>(operation: () => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const disposition = classifyRentalBookingWriteError(error, { retryUniqueConflict: true });
      if (disposition === 'RETRYABLE' && attempt < 2) continue;
      if (disposition === 'RETRYABLE' || disposition === 'CONFLICT') {
        throw new RentalBookingEffectiveRefundConflictError(
          'Post-apply rental refund no longer satisfies the durable effective-settlement contract.',
        );
      }
      throw error;
    }
  }
  throw new RentalBookingEffectiveRefundConflictError(
    'Post-apply rental refund could not be serialized.',
  );
}

async function assertManualReferenceUnused(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  reference: string,
) {
  await transaction.$queryRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${manualReferenceLockKey(organizationId, reference)}, 0)
    )
  `;
  const retainedReference = await transaction.rentalManualProviderReference.findUnique({
    where: {
      organizationId_providerReference: {
        organizationId,
        providerReference: reference,
      },
    },
    select: { sourceLedger: true, sourceId: true },
  });
  if (retainedReference) {
    throw new RentalBookingEffectiveRefundConflictError(
      'Manual rental payment reference has already been retained in this organization.',
    );
  }
}

function retainedFingerprint(row: Readonly<{
  organizationId: string;
  bookingId: string;
  amendmentId: string;
  idempotencyKey: string;
  sourceLedger: 'BOOKING_PRICE' | 'COMMERCIAL_AMENDMENT';
  providerCode: string;
  providerReference: string;
  sourceProviderReference: string;
  currency: string;
  amountMinor: bigint;
}>) {
  return buildRentalBookingEffectiveRefundRequestFingerprint(row);
}

export async function recordRentalBookingPostApplyManualRefund(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  reference: unknown;
  amountMinor: unknown;
}>) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  const reference = normalizeManualPaymentReference(input.reference);

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

  return runWrite(() => db.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${rentalBookingLockKey(input.organizationId, input.bookingId)}, 0)
      )
    `;

    const before = await readRentalBookingEffectiveSettlementInTransaction({
      transaction,
      organizationId: input.organizationId,
      bookingId: input.bookingId,
    });
    if (before.booking.status !== 'CONFIRMED') {
      throw new RentalBookingEffectiveRefundConflictError(
        'Post-apply rental refunds require a confirmed booking.',
      );
    }
    if (!before.appliedAmendment || before.appliedAmendment.status !== 'APPLIED') {
      throw new RentalBookingEffectiveRefundConflictError(
        'This booking has no applied commercial amendment. Use the standard rental refund boundary.',
      );
    }
    if (!before.settlement.reconciled) {
      throw new RentalBookingEffectiveRefundConflictError(
        `Effective rental settlement must reconcile before refunding. ${before.settlement.reason}`,
      );
    }

    const money = normalizePaymentMoney(before.settlement.currency, input.amountMinor);
    const idempotencyKey = buildRentalBookingEffectiveRefundIdempotencyKey({
      bookingId: input.bookingId,
      amendmentId: before.appliedAmendment.id,
      reference,
    });

    const existing = await transaction.rentalBookingEffectiveRefundTransaction.findFirst({
      where: { organizationId: input.organizationId, idempotencyKey },
    });
    if (existing) {
      if (
        existing.bookingId !== input.bookingId
        || existing.amendmentId !== before.appliedAmendment.id
        || existing.providerReference !== reference
        || existing.amountMinor !== money.amountMinor
        || !existing.sourceProviderReference
        || existing.requestFingerprint !== retainedFingerprint({
          organizationId: existing.organizationId,
          bookingId: existing.bookingId,
          amendmentId: existing.amendmentId,
          idempotencyKey: existing.idempotencyKey,
          sourceLedger: existing.sourceLedger,
          providerCode: existing.providerCode,
          providerReference: existing.providerReference,
          sourceProviderReference: existing.sourceProviderReference,
          currency: existing.currency,
          amountMinor: existing.amountMinor,
        })
      ) {
        throw new RentalBookingEffectiveRefundConflictError(
          'Post-apply rental refund idempotency evidence conflicts with the retained request.',
        );
      }
      return Object.freeze({
        transaction: existing,
        settlement: before.settlement,
        idempotent: true as const,
      });
    }

    const plan = deriveRentalBookingEffectiveRefundPlan({
      settlement: before.settlement,
      requestedAmountMinor: money.amountMinor,
    });
    if (!plan.planned) {
      throw new RentalBookingEffectiveRefundConflictError(plan.reason);
    }
    if (plan.currency !== money.currency || plan.providerCode !== manualProvider.code) {
      throw new RentalBookingEffectiveRefundConflictError(
        'Post-apply rental refund plan escaped the retained manual settlement authority.',
      );
    }

    assertPaymentProviderCapability(manualProvider, 'OFFLINE_REFUND_RECORDING');
    await assertManualReferenceUnused(transaction, input.organizationId, reference);

    const requestFingerprint = buildRentalBookingEffectiveRefundRequestFingerprint({
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      amendmentId: before.appliedAmendment.id,
      idempotencyKey,
      sourceLedger: plan.sourceLedger,
      providerCode: manualProvider.code,
      providerReference: reference,
      sourceProviderReference: plan.sourceProviderReference,
      currency: plan.currency,
      amountMinor: plan.amountMinor,
    });

    const providerResult = await manualProvider.recordOfflineRefund({
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      idempotencyKey,
      money: { currency: plan.currency, amountMinor: plan.amountMinor },
      paymentReference: plan.sourceProviderReference,
      refundReference: reference,
    });
    if (
      providerResult.status !== 'REFUNDED'
      || providerResult.providerCode !== manualProvider.code
      || providerResult.providerReference !== plan.sourceProviderReference
      || providerResult.refundReference !== reference
      || providerResult.money.currency !== plan.currency
      || providerResult.money.amountMinor !== plan.amountMinor
    ) {
      throw new RentalBookingEffectiveRefundConflictError(
        'Manual provider result does not match the authoritative post-apply refund plan.',
      );
    }

    const created = await transaction.rentalBookingEffectiveRefundTransaction.create({
      data: {
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        amendmentId: before.appliedAmendment.id,
        idempotencyKey,
        requestFingerprint,
        sourceLedger: plan.sourceLedger,
        status: 'SUCCEEDED',
        providerCode: manualProvider.code,
        providerReference: reference,
        sourceProviderReference: plan.sourceProviderReference,
        currency: plan.currency,
        amountMinor: plan.amountMinor,
      },
    });

    const after = await readRentalBookingEffectiveSettlementInTransaction({
      transaction,
      organizationId: input.organizationId,
      bookingId: input.bookingId,
    });
    if (
      !after.settlement.reconciled
      || after.settlement.currentNetSettledMinor
        !== before.settlement.currentNetSettledMinor - plan.amountMinor
    ) {
      throw new RentalBookingEffectiveRefundConflictError(
        'Post-apply rental refund did not reconcile to the expected effective settlement delta.',
      );
    }

    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'payment.rental.post-apply-refund-recorded',
        resourceType: 'rental-booking-effective-refund-transaction',
        resourceId: created.id,
        afterData: {
          bookingId: input.bookingId,
          amendmentId: before.appliedAmendment.id,
          sourceLedger: plan.sourceLedger,
          providerCode: created.providerCode,
          sourceProviderReference: created.sourceProviderReference,
          currency: created.currency,
          amountMinor: created.amountMinor.toString(),
          effectiveNetBeforeMinor: before.settlement.currentNetSettledMinor.toString(),
          effectiveNetAfterMinor: after.settlement.currentNetSettledMinor.toString(),
        },
      },
    });

    return Object.freeze({
      transaction: created,
      settlement: after.settlement,
      idempotent: false as const,
    });
  }, { isolationLevel: 'Serializable' }));
}
