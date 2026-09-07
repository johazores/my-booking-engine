import type { HospitalitySupplierReservationSubmissionOutcome } from './hospitality-supplier-reservation-service.ts';
import type { TravelportStaysReservationCreateOutcome } from './travelport-stays-reservation-create-outcome.ts';

export function travelportStaysCreateOutcomeToSubmissionOutcome(
  outcome: TravelportStaysReservationCreateOutcome,
): HospitalitySupplierReservationSubmissionOutcome {
  if (outcome.status === 'CONFIRMED') {
    return Object.freeze({
      status: 'CONFIRMED',
      providerReservationReference: outcome.providerReservationReference,
      supplierConfirmationReference: outcome.supplierConfirmationReference,
      providerCorrelationId: outcome.providerCorrelationId,
    });
  }

  if (outcome.status === 'AMBIGUOUS') {
    return Object.freeze({
      status: 'AMBIGUOUS',
      failureCode: outcome.failureCode,
      supplierConfirmationReference: outcome.supplierConfirmationReference,
      providerCorrelationId: outcome.providerCorrelationId,
    });
  }

  if (outcome.status === 'FAILED') {
    return Object.freeze({
      status: 'FAILED',
      failureCode: outcome.failureCode,
      retryable: outcome.retryable,
      providerCorrelationId: outcome.providerCorrelationId,
    });
  }

  throw new Error('Travelport price or guarantee review outcomes require the dedicated durable review settlement path.');
}
