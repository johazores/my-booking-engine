import type { HospitalitySupplierReservationSubmissionOutcome } from './hospitality-supplier-reservation-service.ts';
import type { TravelportStaysReservationCreateOutcome } from './travelport-stays-reservation-create-outcome.ts';

function normalizeTravelportAmbiguousFailureCode(
  outcome: Extract<TravelportStaysReservationCreateOutcome, Readonly<{ status: 'AMBIGUOUS' }>>,
) {
  // Travelport 13034 is not proof that Sync is required: the provider documents both
  // a no-sell branch and a sold-at-Booking.com branch that share the same error. Only
  // supplier-confirmed recovery evidence can retain the actionable Sync-required code.
  if (
    outcome.failureCode === 'TRAVELPORT_SYNC_REQUIRED'
    && !outcome.supplierConfirmationReference
    && !outcome.providerRecoveryReference
  ) {
    return 'TRAVELPORT_SELL_UNCERTAIN' as const;
  }
  return outcome.failureCode;
}

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
      failureCode: normalizeTravelportAmbiguousFailureCode(outcome),
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
