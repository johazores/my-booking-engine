import { releaseHospitalityAvailabilityHoldInTransaction } from '../availability/hospitality-availability-hold-core.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { deriveHospitalityCommercialAmendmentApplyFailureRecoveryRouting } from './booking-commercial-amendment-apply-recovery-domain.ts';
import { deriveHospitalityCommercialAmendmentSettlementState } from './booking-commercial-amendment-settlement-domain.ts';
import { hospitalityBookingMutationLockKey } from './hospitality-booking-mutation-lock.ts';
import { HospitalityBookingConflictError } from './hospitality-booking-service.ts';

async function requireApplyRecoveryPermissions(input: {
  organizationId: string;
  actorUserId: string;
}) {
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

export async function routeSettledHospitalityBookingCommercialAmendmentApplyFailureToRecovery(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  amendmentId: string;
  applyFailureReason: string;
  now?: Date;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  assertUuidIdentifier(input.amendmentId, 'amendmentId');
  await requireApplyRecoveryPermissions(input);
  const now = input.now ?? new Date();

  return db.$transaction(async (transaction) => {
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
        targetHoldId: true,
        adjustmentFingerprint: true,
      },
    });
    if (!amendment) {
      return Object.freeze({ routed: false as const, reason: 'Commercial amendment is unavailable.' });
    }

    const transactions = await transaction.paymentTransaction.findMany({
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
    const routing = deriveHospitalityCommercialAmendmentApplyFailureRecoveryRouting({
      amendmentStatus: amendment.status,
      expiresAt: amendment.expiresAt,
      now,
      settlementState: settlement.state,
    });
    if (!routing.routeToRecovery) {
      return Object.freeze({ routed: false as const, reason: routing.reason, settlementState: settlement.state });
    }

    let holdChanged = false;
    if (amendment.targetHoldId) {
      const hold = await transaction.hospitalityAvailabilityHold.findFirst({
        where: { id: amendment.targetHoldId, organizationId: input.organizationId },
        select: { id: true },
      });
      if (hold) {
        const released = await releaseHospitalityAvailabilityHoldInTransaction({
          transaction,
          organizationId: input.organizationId,
          holdId: hold.id,
          now,
        });
        holdChanged = released.changed;
      }
    }

    const expiryChanged = routing.recoveryExpiresAt.getTime() < amendment.expiresAt.getTime();
    if (expiryChanged) {
      const updated = await transaction.hospitalityBookingCommercialAmendment.updateMany({
        where: {
          id: amendment.id,
          organizationId: input.organizationId,
          bookingId: input.bookingId,
          status: 'PREPARED',
          expiresAt: amendment.expiresAt,
        },
        data: { expiresAt: routing.recoveryExpiresAt },
      });
      if (updated.count !== 1) {
        throw new HospitalityBookingConflictError(
          'Commercial amendment changed while routing settled money into recovery.',
        );
      }
    }

    if (expiryChanged || holdChanged) {
      await transaction.auditEvent.create({
        data: {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: 'booking.commercial-amendment.recovery-required',
          resourceType: 'hospitality-booking-commercial-amendment',
          resourceId: amendment.id,
          beforeData: {
            status: amendment.status,
            expiresAt: amendment.expiresAt.toISOString(),
            targetHoldId: amendment.targetHoldId,
          },
          afterData: {
            status: amendment.status,
            expiresAt: routing.recoveryExpiresAt.toISOString(),
            targetHoldId: amendment.targetHoldId,
            targetHoldReleased: holdChanged,
            settlementState: settlement.state,
            adjustmentFingerprint: amendment.adjustmentFingerprint,
            applyFailureReason: input.applyFailureReason,
          },
        },
      });
    }

    return Object.freeze({
      routed: true as const,
      amendmentId: amendment.id,
      settlementState: settlement.state,
      recoveryExpiresAt: routing.recoveryExpiresAt,
      targetHoldReleased: holdChanged,
    });
  }, { isolationLevel: 'Serializable' });
}
