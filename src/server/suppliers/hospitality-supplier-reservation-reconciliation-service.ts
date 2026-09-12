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
import {
  materializeHospitalitySupplierReservationReconciliationInput,
  materializeHospitalitySupplierReservationRecoveryProvider,
  materializeHospitalitySupplierReservationRecoveryResult,
} from './hospitality-supplier-reservation-reconciliation-authority.ts';
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
  const authority = materializeHospitalitySupplierReservationReconciliationInput(input);
  const claim = await claimHospitalitySupplierReservationReconciliation({
    organizationId: authority.organizationId,
    actorUserId: authority.actorUserId,
    reservationId: authority.reservationId,
  });

  const providerReservationReference = claim.reservation.providerReservationReference;
  if (!providerReservationReference) {
    return settleHospitalitySupplierReservationReconciliation({
      organizationId: authority.organizationId,
      actorUserId: authority.actorUserId,
      reservationId: authority.reservationId,
      attemptId: claim.attempt.id,
      outcome: { status: 'UNKNOWN', failureCode: 'INVALID_REQUEST' },
    });
  }

  let provider;
  try {
    provider = materializeHospitalitySupplierReservationRecoveryProvider(authority.provider);
  } catch {
    return settleHospitalitySupplierReservationReconciliation({
      organizationId: authority.organizationId,
      actorUserId: authority.actorUserId,
      reservationId: authority.reservationId,
      attemptId: claim.attempt.id,
      outcome: { status: 'UNKNOWN', failureCode: 'INVALID_REQUEST' },
    });
  }
  if (provider.code !== claim.reservation.providerCode) {
    return settleHospitalitySupplierReservationReconciliation({
      organizationId: authority.organizationId,
      actorUserId: authority.actorUserId,
      reservationId: authority.reservationId,
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
      organizationId: authority.organizationId,
      actorUserId: authority.actorUserId,
      reservationId: authority.reservationId,
      attemptId: claim.attempt.id,
      requireFreshProviderRequest: true,
    });
  } catch (error) {
    return settleHospitalitySupplierReservationReconciliation({
      organizationId: authority.organizationId,
      actorUserId: authority.actorUserId,
      reservationId: authority.reservationId,
      attemptId: claim.attempt.id,
      outcome: {
        status: 'UNKNOWN',
        failureCode: error instanceof HospitalitySupplierProviderError ? error.code : 'INVALID_REQUEST',
      },
    });
  }

  const providerObservation = createHospitalitySupplierReservationProviderObservation({
    requestCorrelationId: claim.attempt.id,
    organizationId: authority.organizationId,
    provider: claim.reservation.providerCode,
  });

  let rawResult: HospitalitySupplierReservationRecoveryResult;
  try {
    rawResult = await provider.retrieveReservation({
      providerReservationReference,
      requestCorrelationId: claim.attempt.id,
      expectedReservation,
    });
  } catch (error) {
    const failureCode = error instanceof HospitalitySupplierProviderError ? error.code : 'PROVIDER_UNAVAILABLE';
    providerObservation.finish({ status: 'FAILED', failureCode });
    return settleHospitalitySupplierReservationReconciliation({
      organizationId: authority.organizationId,
      actorUserId: authority.actorUserId,
      reservationId: authority.reservationId,
      attemptId: claim.attempt.id,
      outcome: {
        status: 'UNKNOWN',
        failureCode,
      },
    });
  }

  let result: HospitalitySupplierReservationRecoveryResult;
  try {
    result = materializeHospitalitySupplierReservationRecoveryResult(rawResult);
  } catch {
    providerObservation.finish({ status: 'FAILED', failureCode: 'INVALID_RESPONSE' });
    return settleHospitalitySupplierReservationReconciliation({
      organizationId: authority.organizationId,
      actorUserId: authority.actorUserId,
      reservationId: authority.reservationId,
      attemptId: claim.attempt.id,
      outcome: { status: 'UNKNOWN', failureCode: 'INVALID_RESPONSE' },
    });
  }

  if (result.providerReservationReference !== providerReservationReference) {
    providerObservation.finish({ status: 'FAILED', failureCode: 'INVALID_RESPONSE' });
    return settleHospitalitySupplierReservationReconciliation({
      organizationId: authority.organizationId,
      actorUserId: authority.actorUserId,
      reservationId: authority.reservationId,
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
      organizationId: authority.organizationId,
      actorUserId: authority.actorUserId,
      reservationId: authority.reservationId,
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
      && provider.requiresSupplierConfirmationForFound
      && !supplierConfirmationReference
    ) {
      confirmationFailureCode = HOSPITALITY_SUPPLIER_CONFIRMATION_MISSING_FAILURE_CODE;
    }
    if (confirmationFailureCode) {
      providerObservation.finish({ status: 'FAILED', failureCode: 'INVALID_RESPONSE' });
      return settleHospitalitySupplierReservationReconciliation({
        organizationId: authority.organizationId,
        actorUserId: authority.actorUserId,
        reservationId: authority.reservationId,
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
      organizationId: authority.organizationId,
      actorUserId: authority.actorUserId,
      reservationId: authority.reservationId,
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
        organizationId: authority.organizationId,
        actorUserId: authority.actorUserId,
        reservationId: authority.reservationId,
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
      organizationId: authority.organizationId,
      actorUserId: authority.actorUserId,
      reservationId: authority.reservationId,
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
    organizationId: authority.organizationId,
    actorUserId: authority.actorUserId,
    reservationId: authority.reservationId,
    attemptId: claim.attempt.id,
    outcome: { status: 'UNKNOWN', failureCode: 'INVALID_RESPONSE' },
  });
}
