import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  HospitalitySupplierReservationConflictError,
  normalizeHospitalitySupplierReservationSupplierConfirmationReference,
} from './hospitality-supplier-reservation-domain.ts';
import { HospitalitySupplierReservationUnavailableError } from './hospitality-supplier-reservation-service.ts';

const MAX_PROVIDER_RECOVERY_REFERENCE_LENGTH = 1_024;

function supplierReservationOperationLockKey(organizationId: string, reservationId: string) {
  return `supplier-reservation:${organizationId}:operation:${reservationId}`;
}

function normalizeProviderRecoveryReference(value: unknown) {
  if (typeof value !== 'string') {
    throw new HospitalitySupplierReservationConflictError('Supplier reservation provider recovery authority is invalid.');
  }
  const normalized = value.trim();
  if (
    !normalized
    || normalized !== value
    || normalized.length > MAX_PROVIDER_RECOVERY_REFERENCE_LENGTH
    || /[\r\n]/.test(normalized)
  ) {
    throw new HospitalitySupplierReservationConflictError('Supplier reservation provider recovery authority is invalid.');
  }
  return normalized;
}

/**
 * Stages non-secret provider recovery authority after the commercial write marker but before
 * create settlement. If the process crashes after this transaction, stale-attempt recovery can
 * move SUBMITTING -> AMBIGUOUS without losing the evidence needed for provider-specific recovery.
 */
export async function recordHospitalitySupplierReservationProviderRecoveryEvidence(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  reservationId: string;
  attemptId: string;
  supplierConfirmationReference: unknown;
  providerRecoveryReference: unknown;
}>) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.reservationId, 'reservationId');
  assertUuidIdentifier(input.attemptId, 'attemptId');
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'booking:manage',
  });

  const supplierConfirmationReference = normalizeHospitalitySupplierReservationSupplierConfirmationReference(
    input.supplierConfirmationReference,
  );
  if (!supplierConfirmationReference) {
    throw new HospitalitySupplierReservationConflictError(
      'Supplier reservation recovery authority requires a verified supplier confirmation.',
    );
  }
  const providerRecoveryReference = normalizeProviderRecoveryReference(input.providerRecoveryReference);

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
        providerReservationReference: true,
        supplierConfirmationReference: true,
        providerRecoveryReference: true,
      },
    });
    if (!reservation) {
      throw new HospitalitySupplierReservationUnavailableError(
        'Supplier reservation operation is not available in this organization.',
      );
    }
    if (reservation.status !== 'SUBMITTING' || reservation.providerReservationReference) {
      throw new HospitalitySupplierReservationConflictError(
        'Supplier reservation is not eligible to stage provider recovery authority.',
      );
    }

    const attempt = await transaction.hospitalitySupplierReservationAttempt.findFirst({
      where: {
        id: input.attemptId,
        organizationId: input.organizationId,
        reservationId: reservation.id,
        sequence: reservation.attemptCount,
        kind: 'CREATE',
        status: 'STARTED',
      },
      select: {
        id: true,
        sequence: true,
        providerRequestStartedAt: true,
      },
    });
    if (!attempt || !attempt.providerRequestStartedAt) {
      throw new HospitalitySupplierReservationConflictError(
        'Supplier reservation recovery authority requires the current marked provider request.',
      );
    }

    if (
      reservation.supplierConfirmationReference !== null
      || reservation.providerRecoveryReference !== null
    ) {
      if (
        reservation.supplierConfirmationReference === supplierConfirmationReference
        && reservation.providerRecoveryReference === providerRecoveryReference
      ) {
        return reservation;
      }
      throw new HospitalitySupplierReservationConflictError(
        'Supplier reservation recovery authority conflicts with previously staged evidence.',
      );
    }

    const updated = await transaction.hospitalitySupplierReservationOperation.update({
      where: { id: reservation.id, organizationId: input.organizationId },
      data: {
        supplierConfirmationReference,
        providerRecoveryReference,
      },
    });

    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'supplier.reservation-recovery-evidence-recorded',
        resourceType: 'supplier-reservation-operation',
        resourceId: reservation.id,
        afterData: {
          providerCode: reservation.providerCode,
          status: reservation.status,
          attemptSequence: attempt.sequence,
          recoveryEvidenceRecorded: true,
        },
      },
    });

    return updated;
  }, { isolationLevel: 'Serializable' });
}
