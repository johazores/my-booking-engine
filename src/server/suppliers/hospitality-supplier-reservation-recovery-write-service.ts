import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  HospitalitySupplierReservationConflictError,
  normalizeHospitalitySupplierReservationCorrelationId,
  normalizeHospitalitySupplierReservationFailureCode,
  normalizeHospitalitySupplierReservationProviderReference,
  normalizeHospitalitySupplierReservationSupplierConfirmationReference,
} from './hospitality-supplier-reservation-domain.ts';
import { HospitalitySupplierReservationUnavailableError } from './hospitality-supplier-reservation-service.ts';

const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

function supplierReservationOperationLockKey(organizationId: string, reservationId: string) {
  return `supplier-reservation:${organizationId}:operation:${reservationId}`;
}

async function requireRecoveryWriteAuthority(organizationId: string, actorUserId: string) {
  assertUuidIdentifier(organizationId, 'organizationId');
  assertUuidIdentifier(actorUserId, 'actorUserId');
  await requireOrganizationPermission({
    organizationId,
    userId: actorUserId,
    permission: 'booking:manage',
  });
}

function assertIntegrationMatchesReservation(
  integration: { providerCode: string; credentialVersion: number; capabilities: readonly string[] } | null,
  reservation: { providerCode: string; integrationCredentialVersion: number },
) {
  if (
    !integration
    || integration.providerCode !== reservation.providerCode
    || integration.credentialVersion !== reservation.integrationCredentialVersion
    || !integration.capabilities.includes('reservation')
  ) {
    throw new HospitalitySupplierReservationConflictError(
      'Supplier integration changed after recovery authority was recorded. Review the supplier reservation before recovery.',
    );
  }
}

export async function claimHospitalitySupplierReservationRecoveryWrite(input: {
  organizationId: string;
  actorUserId: string;
  reservationId: string;
  reservationPayloadFingerprint: string;
}) {
  await requireRecoveryWriteAuthority(input.organizationId, input.actorUserId);
  assertUuidIdentifier(input.reservationId, 'reservationId');
  if (!FINGERPRINT_PATTERN.test(input.reservationPayloadFingerprint)) {
    throw new HospitalitySupplierReservationConflictError(
      'Supplier reservation recovery traveler authority is invalid.',
    );
  }

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${supplierReservationOperationLockKey(input.organizationId, input.reservationId)}, 0))`;

    const reservation = await transaction.hospitalitySupplierReservationOperation.findFirst({
      where: { id: input.reservationId, organizationId: input.organizationId },
    });
    if (!reservation) {
      throw new HospitalitySupplierReservationUnavailableError(
        'Supplier reservation operation is not available in this organization.',
      );
    }
    if (
      reservation.status !== 'AMBIGUOUS'
      || reservation.providerReservationReference
      || !reservation.supplierConfirmationReference
      || !reservation.providerRecoveryReference
    ) {
      throw new HospitalitySupplierReservationConflictError(
        'Supplier reservation does not have complete locator-less recovery-write authority.',
      );
    }
    if (reservation.reservationPayloadFingerprint !== input.reservationPayloadFingerprint) {
      throw new HospitalitySupplierReservationConflictError(
        'Primary traveler details changed after the supplier reservation request was prepared.',
      );
    }

    const latestAttempt = reservation.attemptCount > 0
      ? await transaction.hospitalitySupplierReservationAttempt.findFirst({
          where: {
            organizationId: input.organizationId,
            reservationId: reservation.id,
            sequence: reservation.attemptCount,
          },
        })
      : null;

    if (
      latestAttempt?.kind === 'RECOVERY_WRITE'
      && !(
        latestAttempt.status === 'FAILED'
        && latestAttempt.providerRequestStartedAt === null
        && reservation.lastFailureRetryable === true
      )
    ) {
      throw new HospitalitySupplierReservationConflictError(
        'Supplier reservation recovery write has already crossed or may have crossed the provider boundary.',
      );
    }

    const integration = await transaction.integration.findFirst({
      where: {
        id: reservation.integrationId,
        organizationId: input.organizationId,
        status: 'ACTIVE',
      },
      select: {
        providerCode: true,
        credentialVersion: true,
        capabilities: true,
      },
    });
    assertIntegrationMatchesReservation(integration, reservation);

    const attemptedAt = new Date();
    const sequence = reservation.attemptCount + 1;
    const updated = await transaction.hospitalitySupplierReservationOperation.update({
      where: { id: reservation.id, organizationId: input.organizationId },
      data: {
        status: 'SUBMITTING',
        attemptCount: sequence,
        lastAttemptAt: attemptedAt,
        lastFailureCode: null,
        lastFailureRetryable: null,
        reconciledAt: null,
      },
    });
    const attempt = await transaction.hospitalitySupplierReservationAttempt.create({
      data: {
        organizationId: input.organizationId,
        reservationId: reservation.id,
        sequence,
        kind: 'RECOVERY_WRITE',
        status: 'STARTED',
        startedAt: attemptedAt,
      },
    });

    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'supplier.reservation-recovery-write-claimed',
        resourceType: 'supplier-reservation-operation',
        resourceId: reservation.id,
        afterData: {
          providerCode: reservation.providerCode,
          status: updated.status,
          attemptSequence: sequence,
        },
      },
    });

    return Object.freeze({ reservation: updated, attempt });
  }, { isolationLevel: 'Serializable' });
}

export type HospitalitySupplierReservationRecoveryWriteOutcome =
  | Readonly<{
      status: 'CONFIRMED';
      providerReservationReference: unknown;
      supplierConfirmationReference: unknown;
      providerCorrelationId?: unknown;
    }>
  | Readonly<{
      status: 'FAILED';
      failureCode: unknown;
      retryable: boolean;
      providerCorrelationId?: unknown;
    }>
  | Readonly<{
      status: 'AMBIGUOUS';
      failureCode?: unknown;
      providerCorrelationId?: unknown;
    }>;

export async function settleHospitalitySupplierReservationRecoveryWrite(input: {
  organizationId: string;
  actorUserId: string;
  reservationId: string;
  attemptId: string;
  outcome: HospitalitySupplierReservationRecoveryWriteOutcome;
}) {
  await requireRecoveryWriteAuthority(input.organizationId, input.actorUserId);
  assertUuidIdentifier(input.reservationId, 'reservationId');
  assertUuidIdentifier(input.attemptId, 'attemptId');

  const providerCorrelationId = normalizeHospitalitySupplierReservationCorrelationId(
    input.outcome.providerCorrelationId,
  );
  const providerReservationReference = input.outcome.status === 'CONFIRMED'
    ? normalizeHospitalitySupplierReservationProviderReference(input.outcome.providerReservationReference)
    : null;
  const supplierConfirmationReference = input.outcome.status === 'CONFIRMED'
    ? normalizeHospitalitySupplierReservationSupplierConfirmationReference(input.outcome.supplierConfirmationReference)
    : null;
  const failureCode = input.outcome.status === 'FAILED'
    ? normalizeHospitalitySupplierReservationFailureCode(input.outcome.failureCode)
    : input.outcome.status === 'AMBIGUOUS' && input.outcome.failureCode !== undefined
      ? normalizeHospitalitySupplierReservationFailureCode(input.outcome.failureCode)
      : null;

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${supplierReservationOperationLockKey(input.organizationId, input.reservationId)}, 0))`;

    const reservation = await transaction.hospitalitySupplierReservationOperation.findFirst({
      where: { id: input.reservationId, organizationId: input.organizationId },
    });
    if (!reservation) {
      throw new HospitalitySupplierReservationUnavailableError(
        'Supplier reservation operation is not available in this organization.',
      );
    }
    if (reservation.status !== 'SUBMITTING') {
      throw new HospitalitySupplierReservationConflictError(
        'Supplier reservation is not waiting for a recovery-write outcome.',
      );
    }

    const attempt = await transaction.hospitalitySupplierReservationAttempt.findFirst({
      where: {
        id: input.attemptId,
        reservationId: reservation.id,
        organizationId: input.organizationId,
        kind: 'RECOVERY_WRITE',
        status: 'STARTED',
      },
    });
    if (!attempt || attempt.sequence !== reservation.attemptCount) {
      throw new HospitalitySupplierReservationConflictError(
        'Supplier reservation recovery-write attempt is no longer current.',
      );
    }
    if (
      (input.outcome.status === 'CONFIRMED' || input.outcome.status === 'AMBIGUOUS')
      && !attempt.providerRequestStartedAt
    ) {
      throw new HospitalitySupplierReservationConflictError(
        'Supplier reservation recovery-write outcome is missing durable provider-request evidence.',
      );
    }
    if (!reservation.supplierConfirmationReference || !reservation.providerRecoveryReference) {
      throw new HospitalitySupplierReservationConflictError(
        'Supplier reservation recovery evidence is no longer complete.',
      );
    }
    if (
      input.outcome.status === 'CONFIRMED'
      && supplierConfirmationReference !== reservation.supplierConfirmationReference
    ) {
      throw new HospitalitySupplierReservationConflictError(
        'Supplier reservation recovery returned a different supplier confirmation reference.',
      );
    }
    if (
      input.outcome.status === 'FAILED'
      && input.outcome.retryable
      && attempt.providerRequestStartedAt !== null
    ) {
      throw new HospitalitySupplierReservationConflictError(
        'A provider-marked recovery write cannot be settled as retryable.',
      );
    }

    const completedAt = new Date();
    const confirmed = input.outcome.status === 'CONFIRMED';
    const updated = await transaction.hospitalitySupplierReservationOperation.update({
      where: { id: reservation.id, organizationId: input.organizationId },
      data: {
        status: confirmed ? 'CONFIRMED' : 'AMBIGUOUS',
        providerReservationReference: confirmed ? providerReservationReference : null,
        supplierConfirmationReference: reservation.supplierConfirmationReference,
        providerRecoveryReference: confirmed ? null : reservation.providerRecoveryReference,
        lastProviderCorrelationId: providerCorrelationId,
        lastFailureCode: failureCode,
        lastFailureRetryable: input.outcome.status === 'FAILED' ? input.outcome.retryable : null,
        reconciledAt: null,
      },
    });
    await transaction.hospitalitySupplierReservationAttempt.update({
      where: { id: attempt.id, organizationId: input.organizationId },
      data: {
        status: confirmed
          ? 'SUCCEEDED'
          : input.outcome.status === 'FAILED'
            ? 'FAILED'
            : 'AMBIGUOUS',
        providerCorrelationId,
        normalizedFailureCode: failureCode,
        completedAt,
      },
    });

    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: confirmed
          ? 'supplier.reservation-recovery-write-confirmed'
          : input.outcome.status === 'FAILED'
            ? 'supplier.reservation-recovery-write-failed'
            : 'supplier.reservation-recovery-write-ambiguous',
        resourceType: 'supplier-reservation-operation',
        resourceId: reservation.id,
        afterData: {
          providerCode: reservation.providerCode,
          status: updated.status,
          attemptSequence: attempt.sequence,
          retryable: input.outcome.status === 'FAILED' ? input.outcome.retryable : false,
          failureCode,
        },
      },
    });

    return updated;
  }, { isolationLevel: 'Serializable' });
}
