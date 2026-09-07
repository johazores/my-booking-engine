import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  HospitalitySupplierReservationConflictError,
  normalizeHospitalitySupplierReservationCorrelationId,
  normalizeHospitalitySupplierReservationFailureCode,
} from './hospitality-supplier-reservation-domain.ts';
import { HospitalitySupplierReservationUnavailableError } from './hospitality-supplier-reservation-service.ts';

const REVIEW_FAILURE_CODES = new Set([
  'SUPPLIER_PRICE_CHANGED',
  'SUPPLIER_GUARANTEE_CHANGED',
  'SUPPLIER_PRICE_AND_GUARANTEE_CHANGED',
]);

function normalizeReviewFailureCode(value: unknown) {
  const failureCode = normalizeHospitalitySupplierReservationFailureCode(value);
  if (!REVIEW_FAILURE_CODES.has(failureCode)) {
    throw new HospitalitySupplierReservationConflictError(
      'Supplier reservation review reason is not recognized as an explicit price or guarantee change.',
    );
  }
  return failureCode;
}

/**
 * Persist definitive provider no-sell evidence that requires an explicit commercial review.
 *
 * This function deliberately does not authorize or claim a second provider write. A future
 * acceptance workflow must re-review current supplier authority and record an explicit decision
 * before moving REVIEW_REQUIRED back into any submitting state.
 */
export async function settleHospitalitySupplierReservationReviewRequired(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  reservationId: string;
  attemptId: string;
  failureCode: unknown;
  providerCorrelationId?: unknown;
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

  const failureCode = normalizeReviewFailureCode(input.failureCode);
  const providerCorrelationId = normalizeHospitalitySupplierReservationCorrelationId(input.providerCorrelationId);

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`supplier-reservation:${input.organizationId}:operation:${input.reservationId}`}, 0))`;

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
        'Supplier reservation is not waiting for a create review outcome.',
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
    if (!attempt.providerRequestStartedAt) {
      throw new HospitalitySupplierReservationConflictError(
        'Supplier reservation review outcome is missing durable provider-request evidence.',
      );
    }

    const completedAt = new Date();
    const updated = await transaction.hospitalitySupplierReservationOperation.update({
      where: { id: reservation.id, organizationId: input.organizationId },
      data: {
        status: 'REVIEW_REQUIRED',
        providerReservationReference: null,
        supplierConfirmationReference: null,
        providerRecoveryReference: null,
        lastProviderCorrelationId: providerCorrelationId,
        lastFailureCode: failureCode,
        lastFailureRetryable: null,
        reconciledAt: null,
      },
    });
    await transaction.hospitalitySupplierReservationAttempt.update({
      where: { id: attempt.id, organizationId: input.organizationId },
      data: {
        status: 'REVIEW_REQUIRED',
        providerCorrelationId,
        normalizedFailureCode: failureCode,
        completedAt,
      },
    });

    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'supplier.reservation-review-required',
        resourceType: 'supplier-reservation-operation',
        resourceId: reservation.id,
        afterData: {
          providerCode: reservation.providerCode,
          status: updated.status,
          attemptSequence: attempt.sequence,
          failureCode,
        },
      },
    });

    return updated;
  }, { isolationLevel: 'Serializable' });
}
