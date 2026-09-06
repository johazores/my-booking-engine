import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
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

  if (result.status === 'FOUND') {
    providerObservation.finish({ status: 'SUCCEEDED', providerResult: 'FOUND' });
    return settleHospitalitySupplierReservationReconciliation({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      reservationId: input.reservationId,
      attemptId: claim.attempt.id,
      outcome: {
        status: 'FOUND',
        providerReservationReference: result.providerReservationReference,
        supplierConfirmationReference: result.supplierConfirmationReference,
        providerCorrelationId: result.providerCorrelationId,
      },
    });
  }

  if (result.status === 'NOT_FOUND') {
    providerObservation.finish({ status: 'SUCCEEDED', providerResult: 'NOT_FOUND' });
    return settleHospitalitySupplierReservationReconciliation({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      reservationId: input.reservationId,
      attemptId: claim.attempt.id,
      outcome: {
        status: 'NOT_FOUND',
        providerReservationReference: result.providerReservationReference,
        providerCorrelationId: result.providerCorrelationId,
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
