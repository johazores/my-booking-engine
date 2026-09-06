import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  HospitalitySupplierReservationConflictError,
} from './hospitality-supplier-reservation-domain.ts';
import {
  HospitalitySupplierReservationAttemptLeaseConflictError,
  assertHospitalitySupplierReservationAttemptLeaseExpired,
  deriveHospitalitySupplierReservationExpiredAttemptRecovery,
} from './hospitality-supplier-reservation-attempt-lease.ts';
import { HospitalitySupplierReservationUnavailableError } from './hospitality-supplier-reservation-service.ts';

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

function expectedAttemptKind(status: 'SUBMITTING' | 'RECONCILING') {
  return status === 'SUBMITTING' ? 'CREATE' as const : 'RECONCILE' as const;
}

export async function markHospitalitySupplierReservationProviderRequestStarted(input: {
  organizationId: string;
  actorUserId: string;
  reservationId: string;
  attemptId: string;
}) {
  await requireSupplierReservationRecoveryAuthority(input.organizationId, input.actorUserId);
  assertUuidIdentifier(input.reservationId, 'reservationId');
  assertUuidIdentifier(input.attemptId, 'attemptId');

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${supplierReservationOperationLockKey(input.organizationId, input.reservationId)}, 0))`;

    const reservation = await transaction.hospitalitySupplierReservationOperation.findFirst({
      where: {
        id: input.reservationId,
        organizationId: input.organizationId,
      },
      select: {
        id: true,
        providerCode: true,
        status: true,
        attemptCount: true,
      },
    });
    if (!reservation) {
      throw new HospitalitySupplierReservationUnavailableError(
        'Supplier reservation operation is not available in this organization.',
      );
    }
    if (reservation.status !== 'SUBMITTING' && reservation.status !== 'RECONCILING') {
      throw new HospitalitySupplierReservationConflictError(
        'Supplier reservation does not have an in-flight provider request that can be started.',
      );
    }

    const attempt = await transaction.hospitalitySupplierReservationAttempt.findFirst({
      where: {
        id: input.attemptId,
        organizationId: input.organizationId,
        reservationId: reservation.id,
        sequence: reservation.attemptCount,
        kind: expectedAttemptKind(reservation.status),
        status: 'STARTED',
      },
    });
    if (!attempt) {
      throw new HospitalitySupplierReservationConflictError(
        'Supplier reservation provider request attempt is no longer current.',
      );
    }
    if (attempt.providerRequestStartedAt) return attempt;

    const [databaseClock] = await transaction.$queryRaw<Array<{ currentTime: Date }>>`SELECT clock_timestamp() AS "currentTime"`;
    if (!databaseClock) {
      throw new HospitalitySupplierReservationConflictError(
        'Supplier reservation provider request time is unavailable.',
      );
    }

    const updatedAttempt = await transaction.hospitalitySupplierReservationAttempt.update({
      where: { id: attempt.id, organizationId: input.organizationId },
      data: {
        providerRequestStartedAt: databaseClock.currentTime,
        leaseStartedAt: databaseClock.currentTime,
      },
    });

    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'supplier.reservation-provider-request-started',
        resourceType: 'supplier-reservation-operation',
        resourceId: reservation.id,
        afterData: {
          providerCode: reservation.providerCode,
          attemptKind: attempt.kind,
          attemptSequence: attempt.sequence,
        },
      },
    });

    return updatedAttempt;
  }, { isolationLevel: 'Serializable' });
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

    const recovery = deriveHospitalitySupplierReservationExpiredAttemptRecovery({
      attemptKind: attempt.kind,
      providerRequestStarted: attempt.providerRequestStartedAt !== null,
    });
    const updatedReservation = await transaction.hospitalitySupplierReservationOperation.update({
      where: { id: reservation.id, organizationId: input.organizationId },
      data: {
        status: recovery.operationStatus,
        lastFailureCode: recovery.failureCode,
        lastFailureRetryable: recovery.retryable,
        reconciledAt: null,
      },
    });
    const updatedAttempt = await transaction.hospitalitySupplierReservationAttempt.update({
      where: { id: attempt.id, organizationId: input.organizationId },
      data: {
        status: recovery.attemptStatus,
        normalizedFailureCode: recovery.failureCode,
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
          providerRequestStarted: attempt.providerRequestStartedAt !== null,
          failureCode: recovery.failureCode,
        },
      },
    });

    return Object.freeze({
      reservation: updatedReservation,
      attempt: updatedAttempt,
    });
  }, { isolationLevel: 'Serializable' });
}
