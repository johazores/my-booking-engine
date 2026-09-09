import type { HospitalitySupplierReservationSubmissionOutcome } from './hospitality-supplier-reservation-service.ts';
import {
  HOSPITALITY_SUPPLIER_CONFIRMATION_MISSING_FAILURE_CODE,
} from './hospitality-supplier-reservation-confirmation-evidence.ts';
import type { TravelportStaysReservationCreateOutcome } from './travelport-stays-reservation-create-outcome.ts';

function normalizeTravelportAmbiguousFailureCode(
  outcome: Extract<TravelportStaysReservationCreateOutcome, Readonly<{ status: 'AMBIGUOUS' }>>,
) {
  // Travelport 13034 is not proof that Sync is required: the provider documents both
  // a no-sell branch and a sold-at-Booking.com branch that share the same error. The
  // actionable Sync-required code is retained only when both pieces of recovery
  // authority are complete: a supplier confirmation and provider recovery reference.
  if (
    outcome.failureCode === 'TRAVELPORT_SYNC_REQUIRED'
    && (!outcome.supplierConfirmationReference || !outcome.providerRecoveryReference)
  ) {
    return 'TRAVELPORT_SELL_UNCERTAIN' as const;
  }
  return outcome.failureCode;
}

export function travelportStaysCreateOutcomeToSubmissionOutcome(
  outcome: TravelportStaysReservationCreateOutcome,
): HospitalitySupplierReservationSubmissionOutcome {
  if (outcome.status === 'CONFIRMED') {
    // Travelport documents the hotel supplier Confirmation Number as part of a
    // successful booking and requires it for cancellation. A PNR without that
    // supplier authority is durable evidence that a sell may exist, but it is not a
    // complete manageable reservation lifecycle. Keep the PNR for reconciliation
    // while refusing to settle the commercial write as confirmed.
    if (!outcome.supplierConfirmationReference) {
      return Object.freeze({
        status: 'AMBIGUOUS',
        failureCode: HOSPITALITY_SUPPLIER_CONFIRMATION_MISSING_FAILURE_CODE,
        providerReservationReference: outcome.providerReservationReference,
        supplierConfirmationReference: null,
        providerCorrelationId: outcome.providerCorrelationId,
      });
    }

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
