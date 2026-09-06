import type { HospitalitySupplierReservationSubmissionOutcome } from './hospitality-supplier-reservation-service.ts';
import type { TravelportStaysReservationCreateOutcome } from './travelport-stays-reservation-create-outcome.ts';

const REVIEW_FAILURE_CODES = Object.freeze({
  PRICE_CHANGED: 'SUPPLIER_PRICE_CHANGED',
  GUARANTEE_CHANGED: 'SUPPLIER_GUARANTEE_CHANGED',
  PRICE_AND_GUARANTEE_CHANGED: 'SUPPLIER_PRICE_AND_GUARANTEE_CHANGED',
} as const);

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

  return Object.freeze({
    status: 'FAILED',
    failureCode: REVIEW_FAILURE_CODES[outcome.reason],
    retryable: false,
    providerCorrelationId: outcome.providerCorrelationId,
  });
}
