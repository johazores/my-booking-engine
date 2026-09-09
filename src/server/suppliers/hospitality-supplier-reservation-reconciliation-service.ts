import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import {
  normalizeHospitalitySupplierReservationCorrelationId,
  normalizeHospitalitySupplierReservationSupplierConfirmationReference,
} from './hospitality-supplier-reservation-domain.ts';
import {
  markHospitalitySupplierReservationProviderRequestStarted,
} from './hospitality-supplier-reservation-attempt-recovery-service.ts';
import {
  HOSPITALITY_SUPPLIER_CONFIRMATION_MISSING_FAILURE_CODE,
  hospitalitySupplierReservationRecoveryConfirmationFailureCode,
} from './hospitality-supplier-reservation-confirmation-evidence.ts';
import { createHospitalitySupplierReservationProviderObservation } from './hospitality-supplier-reservation-observability.ts';
import type {
  HospitalitySupplierReservationRecoveryProvider,
  HospitalitySupplierReservationRecoveryResult,
} from './hospitality-supplier-reservation-recovery-provider.ts';
import {
  claimHospitalitySupplierReservationReconciliation,
  settleHospitalitySupplierReservationReconciliation,
} from './hospitality-supplier-reservation-service.ts';

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

export async function reconcileHospitalitySupplierReservationWithProvider(input: {
  organizationId: string;
  actorUserId: string;
  reservationId: string;
  provider: HospitalitySupplierReservationRecoveryProvider;
}) {
  const claim = await claimHospitalitySupplierReservationReconciliation({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    reservationId: input.reservationId,
  });

  const providerReservationReference = claim.reservation.providerReservationReference;
  if (!providerReservationReference || input.provider.code !== claim.reservation.providerCode) {
    return settleHospitalitySupplierReservationReconciliation({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      reservationId: input.reservationId,
      attemptId: claim.attempt.id,
      outcome: { status: 'UNKNOWN', failureCode: 'INVALID_REQUEST' },
    });
  }

  const expectedReservation = Object.freeze({
    supplierPropertyReference: claim.reservation.supplierPropertyReference,
    arrivalDateLocal: dateOnly(claim.reservation.arrivalDate),
    departureDateLocal: dateOnly(claim.reservation.departureDate),
    rooms: claim.reservation.rooms,
    adults: claim.reservation.adults,
    childAges: Object.freeze([...claim.reservation.childAges]),
  });

  try {
    await markHospitalitySupplierReservationProviderRequestStarted({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      reservationId: input.reservationId,
      attemptId: claim.attempt.id,
      requireFreshProviderRequest: true,
    });
  } catch (error) {
    return settleHospitalitySupplierReservationReconciliation({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      reservationId: input.reservationId,
      attemptId: claim.attempt.id,
      outcome: {
        status: 'UNKNOWN',
        failureCode: error instanceof HospitalitySupplierProviderError ? error.code : 'INVALID_REQUEST',
      },
    });
  }

  const providerObservation = createHospitalitySupplierReservationProviderObservation({
    requestCorrelationId: claim.attempt.id,
    organizationId: input.organizationId,
    provider: claim.reservation.providerCode,
  });

  let result: HospitalitySupplierReservationRecoveryResult;
  try {
    result = await input.provider.retrieveReservation({
      providerReservationReference,
      requestCorrelationId: claim.attempt.id,
      expectedReservation,
    });
  } catch (error) {
    const failureCode = error instanceof HospitalitySupplierProviderError ? error.code : 'PROVIDER_UNAVAILABLE';
    providerObservation.finish({ status: 'FAILED', failureCode });
    return settleHospitalitySupplierReservationReconciliation({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      reservationId: input.reservationId,
      attemptId: claim.attempt.id,
      outcome: {
        status: 'UNKNOWN',
        failureCode,
      },
    });
  }

  if (!result || typeof result !== 'object' || result.providerReservationReference !== providerReservationReference) {
    providerObservation.finish({ status: 'FAILED', failureCode: 'INVALID_RESPONSE' });
    return settleHospitalitySupplierReservationReconciliation({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      reservationId: input.reservationId,
      attemptId: claim.attempt.id,
      outcome: { status: 'UNKNOWN', failureCode: 'INVALID_RESPONSE' },
    });
  }

  const rawSupplierConfirmationReference = (
    result as Readonly<{ supplierConfirmationReference?: unknown }>
  ).supplierConfirmationReference;
  let providerCorrelationId: string | null;
  let supplierConfirmationReference: string | null = null;
  try {
    providerCorrelationId = normalizeHospitalitySupplierReservationCorrelationId(result.providerCorrelationId);
    if (result.status === 'FOUND') {
      supplierConfirmationReference = normalizeHospitalitySupplierReservationSupplierConfirmationReference(
        rawSupplierConfirmationReference,
      );
    }
  } catch {
    providerObservation.finish({ status: 'FAILED', failureCode: 'INVALID_RESPONSE' });
    return settleHospitalitySupplierReservationReconciliation({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      reservationId: input.reservationId,
      attemptId: claim.attempt.id,
      outcome: { status: 'UNKNOWN', failureCode: 'INVALID_RESPONSE' },
    });
  }

  if (result.status === 'FOUND') {
    let confirmationFailureCode = hospitalitySupplierReservationRecoveryConfirmationFailureCode({
      status: 'FOUND',
      lastFailureCode: claim.reservation.lastFailureCode,
      durableSupplierConfirmationReference: claim.reservation.supplierConfirmationReference,
      recoveredSupplierConfirmationReference: supplierConfirmationReference,
    });
    if (
      !confirmationFailureCode
      && input.provider.requiresSupplierConfirmationForFound === true
      && !supplierConfirmationReference
    ) {
      confirmationFailureCode = HOSPITALITY_SUPPLIER_CONFIRMATION_MISSING_FAILURE_CODE;
    }
    if (confirmationFailureCode) {
      providerObservation.finish({ status: 'FAILED', failureCode: 'INVALID_RESPONSE' });
      return settleHospitalitySupplierReservationReconciliation({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        reservationId: input.reservationId,
        attemptId: claim.attempt.id,
        outcome: {
          status: 'UNKNOWN',
          failureCode: confirmationFailureCode,
          providerCorrelationId,
        },
      });
    }

    providerObservation.finish({ status: 'SUCCEEDED', providerResult: 'FOUND' });
    return settleHospitalitySupplierReservationReconciliation({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      reservationId: input.reservationId,
      attemptId: claim.attempt.id,
      outcome: {
        status: 'FOUND',
        providerReservationReference: result.providerReservationReference,
        supplierConfirmationReference,
        providerCorrelationId,
      },
    });
  }

  if (result.status === 'NOT_FOUND') {
    const confirmationFailureCode = hospitalitySupplierReservationRecoveryConfirmationFailureCode({
      status: 'NOT_FOUND',
      lastFailureCode: claim.reservation.lastFailureCode,
      durableSupplierConfirmationReference: claim.reservation.supplierConfirmationReference,
      recoveredSupplierConfirmationReference: rawSupplierConfirmationReference,
    });
    if (confirmationFailureCode) {
      providerObservation.finish({ status: 'FAILED', failureCode: 'INVALID_RESPONSE' });
      return settleHospitalitySupplierReservationReconciliation({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        reservationId: input.reservationId,
        attemptId: claim.attempt.id,
        outcome: {
          status: 'UNKNOWN',
          failureCode: confirmationFailureCode,
          providerCorrelationId,
        },
      });
    }

    providerObservation.finish({ status: 'SUCCEEDED', providerResult: 'NOT_FOUND' });
    return settleHospitalitySupplierReservationReconciliation({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      reservationId: input.reservationId,
      attemptId: claim.attempt.id,
      outcome: {
        status: 'NOT_FOUND',
        providerReservationReference: result.providerReservationReference,
        providerCorrelationId,
      },
    });
  }

  providerObservation.finish({ status: 'FAILED', failureCode: 'INVALID_RESPONSE' });
  return settleHospitalitySupplierReservationReconciliation({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    reservationId: input.reservationId,
    attemptId: claim.attempt.id,
    outcome: { status: 'UNKNOWN', failureCode: 'INVALID_RESPONSE' },
  });
}
