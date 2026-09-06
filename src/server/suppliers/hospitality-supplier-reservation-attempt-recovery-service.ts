import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  HospitalitySupplierReservationConflictError,
} from './hospitality-supplier-reservation-domain.ts';
import {
  HospitalitySupplierReservationAttemptLeaseConflictError,
  assertHospitalitySupplierReservationAttemptLeaseExpired,
} from './hospitality-supplier-reservation-attempt-lease.ts';
import { HospitalitySupplierReservationUnavailableError } from './hospitality-supplier-reservation-service.ts';

const EXECUTION_LEASE_EXPIRED_FAILURE_CODE = 'EXECUTION_LEASE_EXPIRED';

function supplierReservationOperationLockKey(organizationId: string, reservationId: string) {
  return `supplier-reservation:${organizationId}:operation:${reservationId}`;
}

async function requireSupplierReservationRecoveryAuthority(organizationId: string, actorUserId: string) {
  assertUuidIdentifier(organizationId, 'organizationId');
  assertUuidIdentifier(actorUserId, 'actorUserId');
  await requireOrganizationPermission({
    organizationId,
    userId: actorUserId,
    permission: 'booking:manage',
  });
}

export async function recoverStaleHospitalitySupplierReservationAttempt(input: {
  organizationId: string;
  actorUserId: string;
  reservationId: string;
}) {
  await requireSupplierReservationRecoveryAuthority(input.organizationId, input.actorUserId);
  assertUuidIdentifier(input.reservationId, 'reservationId');

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${supplierReservationOperationLockKey(input.organizationId, input.reservationId)}, 0))`;

    const reservation = await transaction.hospitalitySupplierReservationOperation.findFirst({
      where: {
        id: input.reservationId,
        organizationId: input.organizationId,
      },
    });
    if (!reservation) {
      throw new HospitalitySupplierReservationUnavailableError(
        'Supplier reservation operation is not available in this organization.',
      );
    }
    if (reservation.status !== 'SUBMITTING' && reservation.status !== 'RECONCILING') {
      throw new HospitalitySupplierReservationConflictError(
        'Supplier reservation does not have an in-flight attempt that can be recovered.',
      );
    }

    const attempt = await transaction.hospitalitySupplierReservationAttempt.findFirst({
      where: {
        organizationId: input.organizationId,
        reservationId: reservation.id,
        sequence: reservation.attemptCount,
        status: 'STARTED',
      },
    });
    if (!attempt) {
      throw new HospitalitySupplierReservationConflictError(
        'Supplier reservation current attempt is not available for stale recovery.',
      );
    }
    if (!attempt.leaseStartedAt) {
      throw new HospitalitySupplierReservationConflictError(
        'Supplier reservation attempt lease authority is unavailable.',
      );
    }

    const [databaseClock] = await transaction.$queryRaw<Array<{ currentTime: Date }>>`SELECT clock_timestamp() AS "currentTime"`;
    if (!databaseClock) {
      throw new HospitalitySupplierReservationConflictError(
        'Supplier reservation recovery time is unavailable.',
      );
    }
    const recoveredAt = databaseClock.currentTime;
    try {
      assertHospitalitySupplierReservationAttemptLeaseExpired({
        operationStatus: reservation.status,
        attemptKind: attempt.kind,
        attemptStatus: attempt.status,
        attemptSequence: attempt.sequence,
        currentAttemptCount: reservation.attemptCount,
        startedAt: attempt.leaseStartedAt,
        now: recoveredAt,
      });
    } catch (error) {
      if (error instanceof HospitalitySupplierReservationAttemptLeaseConflictError) {
        throw new HospitalitySupplierReservationConflictError(error.message);
      }
      throw error;
    }

    const updatedReservation = await transaction.hospitalitySupplierReservationOperation.update({
      where: { id: reservation.id },
      data: {
        status: 'AMBIGUOUS',
        lastFailureCode: EXECUTION_LEASE_EXPIRED_FAILURE_CODE,
        lastFailureRetryable: null,
        reconciledAt: null,
      },
    });
    const updatedAttempt = await transaction.hospitalitySupplierReservationAttempt.update({
      where: { id: attempt.id },
      data: {
        status: 'AMBIGUOUS',
        normalizedFailureCode: EXECUTION_LEASE_EXPIRED_FAILURE_CODE,
        completedAt: recoveredAt,
      },
    });

    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: attempt.kind === 'CREATE'
          ? 'supplier.reservation-submission-lease-expired'
          : 'supplier.reservation-reconciliation-lease-expired',
        resourceType: 'supplier-reservation-operation',
        resourceId: reservation.id,
        afterData: {
          providerCode: reservation.providerCode,
          status: updatedReservation.status,
          attemptKind: attempt.kind,
          attemptSequence: attempt.sequence,
          failureCode: EXECUTION_LEASE_EXPIRED_FAILURE_CODE,
        },
      },
    });

    return Object.freeze({
      reservation: updatedReservation,
      attempt: updatedAttempt,
    });
  }, { isolationLevel: 'Serializable' });
}
