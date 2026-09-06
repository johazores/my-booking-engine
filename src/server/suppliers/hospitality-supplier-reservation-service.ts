import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  HospitalitySupplierReservationConflictError,
  assertHospitalitySupplierReservationCanReconcile,
  assertHospitalitySupplierReservationCanSubmit,
  assertHospitalitySupplierReservationExactRetry,
  hospitalitySupplierReservationRequestFingerprint,
  normalizeHospitalitySupplierReservationCorrelationId,
  normalizeHospitalitySupplierReservationFailureCode,
  normalizeHospitalitySupplierReservationIdempotencyKey,
  normalizeHospitalitySupplierReservationProviderReference,
  normalizeHospitalitySupplierReservationSelection,
  normalizeHospitalitySupplierReservationSupplierConfirmationReference,
  type HospitalitySupplierReservationSelectionInput,
} from './hospitality-supplier-reservation-domain.ts';

function supplierReservationLockKey(organizationId: string, scope: string, value: string) {
  return `supplier-reservation:${organizationId}:${scope}:${value}`;
}

export class HospitalitySupplierReservationUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HospitalitySupplierReservationUnavailableError';
  }
}

async function requireSupplierReservationAuthority(organizationId: string, actorUserId: string) {
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
      'Supplier integration changed after the reservation request was prepared. Review the supplier offer and terms again.',
    );
  }
}

export async function prepareHospitalitySupplierReservation(input: {
  organizationId: string;
  actorUserId: string;
  integrationId: string;
  idempotencyKey: unknown;
  selection: HospitalitySupplierReservationSelectionInput;
}) {
  await requireSupplierReservationAuthority(input.organizationId, input.actorUserId);
  assertUuidIdentifier(input.integrationId, 'integrationId');
  const idempotencyKey = normalizeHospitalitySupplierReservationIdempotencyKey(input.idempotencyKey);
  const selection = normalizeHospitalitySupplierReservationSelection(input.selection);
  const requestFingerprint = hospitalitySupplierReservationRequestFingerprint(selection);

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${supplierReservationLockKey(input.organizationId, 'idempotency', idempotencyKey)}, 0))`;

    const existing = await transaction.hospitalitySupplierReservationOperation.findUnique({
      where: {
        organizationId_idempotencyKey: {
          organizationId: input.organizationId,
          idempotencyKey,
        },
      },
    });
    if (existing) {
      assertHospitalitySupplierReservationExactRetry(existing, requestFingerprint);
      if (existing.integrationId !== input.integrationId) {
        throw new HospitalitySupplierReservationConflictError(
          'Reservation idempotency key was already used with a different supplier integration.',
        );
      }
      return existing;
    }

    const integration = await transaction.integration.findFirst({
      where: {
        id: input.integrationId,
        organizationId: input.organizationId,
        providerCode: selection.providerCode,
        status: 'ACTIVE',
        capabilities: { has: 'reservation' },
      },
      select: {
        id: true,
        providerCode: true,
        credentialVersion: true,
      },
    });
    if (!integration) {
      throw new HospitalitySupplierReservationUnavailableError(
        'An active supplier reservation integration is not available in this organization.',
      );
    }

    const reservation = await transaction.hospitalitySupplierReservationOperation.create({
      data: {
        organizationId: input.organizationId,
        integrationId: integration.id,
        integrationCredentialVersion: integration.credentialVersion,
        idempotencyKey,
        requestFingerprint,
        providerCode: selection.providerCode,
        supplierPropertyReference: selection.supplierPropertyReference,
        supplierOfferReference: selection.supplierOfferReference,
        offerFingerprint: selection.offerFingerprint,
        termsFingerprint: selection.termsFingerprint,
        reservationPayloadFingerprint: selection.reservationPayloadFingerprint,
        currency: selection.currency,
        expectedTotalMinor: selection.expectedTotalMinor,
        arrivalDate: new Date(`${selection.arrivalDateLocal}T00:00:00.000Z`),
        departureDate: new Date(`${selection.departureDateLocal}T00:00:00.000Z`),
        rooms: selection.rooms,
        adults: selection.adults,
        childAges: [...selection.childAges],
      },
    });

    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'supplier.reservation-prepared',
        resourceType: 'supplier-reservation-operation',
        resourceId: reservation.id,
        afterData: {
          providerCode: reservation.providerCode,
          status: reservation.status,
          integrationCredentialVersion: reservation.integrationCredentialVersion,
        },
      },
    });

    return reservation;
  }, { isolationLevel: 'Serializable' });
}

export async function claimHospitalitySupplierReservationSubmission(input: {
  organizationId: string;
  actorUserId: string;
  reservationId: string;
}) {
  await requireSupplierReservationAuthority(input.organizationId, input.actorUserId);
  assertUuidIdentifier(input.reservationId, 'reservationId');

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${supplierReservationLockKey(input.organizationId, 'operation', input.reservationId)}, 0))`;

    const reservation = await transaction.hospitalitySupplierReservationOperation.findFirst({
      where: { id: input.reservationId, organizationId: input.organizationId },
    });
    if (!reservation) {
      throw new HospitalitySupplierReservationUnavailableError(
        'Supplier reservation operation is not available in this organization.',
      );
    }
    assertHospitalitySupplierReservationCanSubmit(reservation);

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
      where: { id: reservation.id },
      data: {
        status: 'SUBMITTING',
        attemptCount: sequence,
        lastAttemptAt: attemptedAt,
        lastFailureCode: null,
        lastFailureRetryable: null,
      },
    });
    const attempt = await transaction.hospitalitySupplierReservationAttempt.create({
      data: {
        organizationId: input.organizationId,
        reservationId: reservation.id,
        sequence,
        kind: 'CREATE',
        status: 'STARTED',
        startedAt: attemptedAt,
      },
    });

    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'supplier.reservation-submission-claimed',
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

export type HospitalitySupplierReservationSubmissionOutcome =
  | Readonly<{
      status: 'CONFIRMED';
      providerReservationReference: unknown;
      supplierConfirmationReference?: unknown;
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
      providerReservationReference?: unknown;
      providerCorrelationId?: unknown;
    }>;

export async function settleHospitalitySupplierReservationSubmission(input: {
  organizationId: string;
  actorUserId: string;
  reservationId: string;
  attemptId: string;
  outcome: HospitalitySupplierReservationSubmissionOutcome;
}) {
  await requireSupplierReservationAuthority(input.organizationId, input.actorUserId);
  assertUuidIdentifier(input.reservationId, 'reservationId');
  assertUuidIdentifier(input.attemptId, 'attemptId');
  const providerCorrelationId = normalizeHospitalitySupplierReservationCorrelationId(input.outcome.providerCorrelationId);
  const providerReservationReference = input.outcome.status === 'CONFIRMED'
    ? normalizeHospitalitySupplierReservationProviderReference(input.outcome.providerReservationReference)
    : input.outcome.status === 'AMBIGUOUS' && input.outcome.providerReservationReference !== undefined
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
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${supplierReservationLockKey(input.organizationId, 'operation', input.reservationId)}, 0))`;

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
        'Supplier reservation is not waiting for a create outcome.',
      );
    }

    const attempt = await transaction.hospitalitySupplierReservationAttempt.findFirst({
      where: {
        id: input.attemptId,
        reservationId: reservation.id,
        organizationId: input.organizationId,
        kind: 'CREATE',
        status: 'STARTED',
      },
    });
    if (!attempt || attempt.sequence !== reservation.attemptCount) {
      throw new HospitalitySupplierReservationConflictError(
        'Supplier reservation create attempt is no longer current.',
      );
    }

    const completedAt = new Date();
    const status = input.outcome.status;
    const updated = await transaction.hospitalitySupplierReservationOperation.update({
      where: { id: reservation.id },
      data: {
        status,
        providerReservationReference,
        supplierConfirmationReference,
        lastProviderCorrelationId: providerCorrelationId,
        lastFailureCode: failureCode,
        lastFailureRetryable: input.outcome.status === 'FAILED' ? input.outcome.retryable : null,
        reconciledAt: null,
      },
    });
    await transaction.hospitalitySupplierReservationAttempt.update({
      where: { id: attempt.id },
      data: {
        status: status === 'CONFIRMED' ? 'SUCCEEDED' : status,
        providerCorrelationId,
        normalizedFailureCode: failureCode,
        completedAt,
      },
    });

    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: status === 'CONFIRMED'
          ? 'supplier.reservation-confirmed'
          : status === 'AMBIGUOUS'
            ? 'supplier.reservation-ambiguous'
            : 'supplier.reservation-failed',
        resourceType: 'supplier-reservation-operation',
        resourceId: reservation.id,
        afterData: {
          providerCode: reservation.providerCode,
          status,
          attemptSequence: attempt.sequence,
          retryable: input.outcome.status === 'FAILED' ? input.outcome.retryable : false,
          failureCode,
        },
      },
    });

    return updated;
  }, { isolationLevel: 'Serializable' });
}

export async function claimHospitalitySupplierReservationReconciliation(input: {
  organizationId: string;
  actorUserId: string;
  reservationId: string;
}) {
  await requireSupplierReservationAuthority(input.organizationId, input.actorUserId);
  assertUuidIdentifier(input.reservationId, 'reservationId');

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${supplierReservationLockKey(input.organizationId, 'operation', input.reservationId)}, 0))`;

    const reservation = await transaction.hospitalitySupplierReservationOperation.findFirst({
      where: { id: input.reservationId, organizationId: input.organizationId },
    });
    if (!reservation) {
      throw new HospitalitySupplierReservationUnavailableError(
        'Supplier reservation operation is not available in this organization.',
      );
    }
    assertHospitalitySupplierReservationCanReconcile(reservation.status);
    if (!reservation.providerReservationReference) {
      throw new HospitalitySupplierReservationConflictError(
        'Supplier reservation cannot be reconciled automatically without a provider reservation reference.',
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
      where: { id: reservation.id },
      data: {
        status: 'RECONCILING',
        attemptCount: sequence,
        lastAttemptAt: attemptedAt,
      },
    });
    const attempt = await transaction.hospitalitySupplierReservationAttempt.create({
      data: {
        organizationId: input.organizationId,
        reservationId: reservation.id,
        sequence,
        kind: 'RECONCILE',
        status: 'STARTED',
        startedAt: attemptedAt,
      },
    });

    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'supplier.reservation-reconciliation-claimed',
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

export type HospitalitySupplierReservationReconciliationOutcome =
  | Readonly<{
      status: 'FOUND';
      providerReservationReference: unknown;
      supplierConfirmationReference?: unknown;
      providerCorrelationId?: unknown;
    }>
  | Readonly<{
      status: 'NOT_FOUND';
      providerReservationReference: unknown;
      providerCorrelationId?: unknown;
    }>
  | Readonly<{
      status: 'UNKNOWN';
      failureCode?: unknown;
      providerCorrelationId?: unknown;
    }>;

export async function settleHospitalitySupplierReservationReconciliation(input: {
  organizationId: string;
  actorUserId: string;
  reservationId: string;
  attemptId: string;
  outcome: HospitalitySupplierReservationReconciliationOutcome;
}) {
  await requireSupplierReservationAuthority(input.organizationId, input.actorUserId);
  assertUuidIdentifier(input.reservationId, 'reservationId');
  assertUuidIdentifier(input.attemptId, 'attemptId');
  const providerCorrelationId = normalizeHospitalitySupplierReservationCorrelationId(input.outcome.providerCorrelationId);
  const providerReservationReference = input.outcome.status === 'FOUND' || input.outcome.status === 'NOT_FOUND'
    ? normalizeHospitalitySupplierReservationProviderReference(input.outcome.providerReservationReference)
    : null;
  const supplierConfirmationReference = input.outcome.status === 'FOUND'
    ? normalizeHospitalitySupplierReservationSupplierConfirmationReference(input.outcome.supplierConfirmationReference)
    : null;
  const failureCode = input.outcome.status === 'UNKNOWN' && input.outcome.failureCode !== undefined
    ? normalizeHospitalitySupplierReservationFailureCode(input.outcome.failureCode)
    : null;

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${supplierReservationLockKey(input.organizationId, 'operation', input.reservationId)}, 0))`;

    const reservation = await transaction.hospitalitySupplierReservationOperation.findFirst({
      where: { id: input.reservationId, organizationId: input.organizationId },
    });
    if (!reservation) {
      throw new HospitalitySupplierReservationUnavailableError(
        'Supplier reservation operation is not available in this organization.',
      );
    }
    if (reservation.status !== 'RECONCILING') {
      throw new HospitalitySupplierReservationConflictError(
        'Supplier reservation is not waiting for reconciliation.',
      );
    }

    const attempt = await transaction.hospitalitySupplierReservationAttempt.findFirst({
      where: {
        id: input.attemptId,
        reservationId: reservation.id,
        organizationId: input.organizationId,
        kind: 'RECONCILE',
        status: 'STARTED',
      },
    });
    if (!attempt || attempt.sequence !== reservation.attemptCount) {
      throw new HospitalitySupplierReservationConflictError(
        'Supplier reservation reconciliation attempt is no longer current.',
      );
    }
    if (
      (input.outcome.status === 'FOUND' || input.outcome.status === 'NOT_FOUND')
      && reservation.providerReservationReference !== providerReservationReference
    ) {
      throw new HospitalitySupplierReservationConflictError(
        'Supplier reservation recovery returned a different provider reservation reference.',
      );
    }

    const completedAt = new Date();
    const nextStatus = input.outcome.status === 'FOUND'
      ? 'CONFIRMED'
      : input.outcome.status === 'NOT_FOUND'
        ? 'PREPARED'
        : 'AMBIGUOUS';
    const nextProviderReservationReference = input.outcome.status === 'FOUND'
      ? providerReservationReference
      : input.outcome.status === 'NOT_FOUND'
        ? null
        : reservation.providerReservationReference;
    const nextSupplierConfirmationReference = input.outcome.status === 'FOUND'
      ? supplierConfirmationReference
      : input.outcome.status === 'NOT_FOUND'
        ? null
        : reservation.supplierConfirmationReference;
    const updated = await transaction.hospitalitySupplierReservationOperation.update({
      where: { id: reservation.id },
      data: {
        status: nextStatus,
        providerReservationReference: nextProviderReservationReference,
        supplierConfirmationReference: nextSupplierConfirmationReference,
        lastProviderCorrelationId: providerCorrelationId,
        lastFailureCode: failureCode,
        lastFailureRetryable: null,
        reconciledAt: completedAt,
      },
    });
    await transaction.hospitalitySupplierReservationAttempt.update({
      where: { id: attempt.id },
      data: {
        status: input.outcome.status === 'FOUND'
          ? 'SUCCEEDED'
          : input.outcome.status === 'NOT_FOUND'
            ? 'NOT_FOUND'
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
        action: input.outcome.status === 'FOUND'
          ? 'supplier.reservation-reconciliation-found'
          : input.outcome.status === 'NOT_FOUND'
            ? 'supplier.reservation-reconciliation-not-found'
            : 'supplier.reservation-reconciliation-ambiguous',
        resourceType: 'supplier-reservation-operation',
        resourceId: reservation.id,
        afterData: {
          providerCode: reservation.providerCode,
          status: nextStatus,
          attemptSequence: attempt.sequence,
          failureCode,
        },
      },
    });

    return updated;
  }, { isolationLevel: 'Serializable' });
}
