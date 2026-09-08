import assert from 'node:assert/strict';
import test from 'node:test';

import { travelportStaysCreateOutcomeToSubmissionOutcome } from './travelport-stays-reservation-submission-outcome.ts';

test('maps confirmed Travelport evidence into the durable confirmed settlement shape', () => {
  assert.deepEqual(travelportStaysCreateOutcomeToSubmissionOutcome({
    status: 'CONFIRMED',
    providerReservationReference: '0GQ9HS',
    supplierConfirmationReference: 'T9RY0-WQ842',
    providerCorrelationId: 'trace-1',
  }), {
    status: 'CONFIRMED',
    providerReservationReference: '0GQ9HS',
    supplierConfirmationReference: 'T9RY0-WQ842',
    providerCorrelationId: 'trace-1',
  });
});

test('keeps proven supplier-confirmed recovery evidence Sync-required and never invents retryability', () => {
  assert.deepEqual(travelportStaysCreateOutcomeToSubmissionOutcome({
    status: 'AMBIGUOUS',
    failureCode: 'TRAVELPORT_SYNC_REQUIRED',
    supplierConfirmationReference: 'T9RY0-WQ842',
    providerRecoveryReference: 'v1.sync-evidence',
    providerCorrelationId: 'trace-2',
  }), {
    status: 'AMBIGUOUS',
    failureCode: 'TRAVELPORT_SYNC_REQUIRED',
    supplierConfirmationReference: 'T9RY0-WQ842',
    providerCorrelationId: 'trace-2',
  });
});

test('downgrades Sync-required ambiguity when either recovery authority component is missing', () => {
  assert.deepEqual(travelportStaysCreateOutcomeToSubmissionOutcome({
    status: 'AMBIGUOUS',
    failureCode: 'TRAVELPORT_SYNC_REQUIRED',
    supplierConfirmationReference: 'T9RY0-WQ842',
    providerRecoveryReference: null,
    providerCorrelationId: 'trace-partial-confirmation',
  }), {
    status: 'AMBIGUOUS',
    failureCode: 'TRAVELPORT_SELL_UNCERTAIN',
    supplierConfirmationReference: 'T9RY0-WQ842',
    providerCorrelationId: 'trace-partial-confirmation',
  });

  assert.deepEqual(travelportStaysCreateOutcomeToSubmissionOutcome({
    status: 'AMBIGUOUS',
    failureCode: 'TRAVELPORT_SYNC_REQUIRED',
    supplierConfirmationReference: null,
    providerRecoveryReference: 'v1.sync-evidence',
    providerCorrelationId: 'trace-partial-recovery',
  }), {
    status: 'AMBIGUOUS',
    failureCode: 'TRAVELPORT_SELL_UNCERTAIN',
    supplierConfirmationReference: null,
    providerCorrelationId: 'trace-partial-recovery',
  });
});

test('normalizes locator-less 13034-style ambiguity without recovery evidence as sell-uncertain', () => {
  assert.deepEqual(travelportStaysCreateOutcomeToSubmissionOutcome({
    status: 'AMBIGUOUS',
    failureCode: 'TRAVELPORT_SYNC_REQUIRED',
    supplierConfirmationReference: null,
    providerCorrelationId: 'trace-13034',
  }), {
    status: 'AMBIGUOUS',
    failureCode: 'TRAVELPORT_SELL_UNCERTAIN',
    supplierConfirmationReference: null,
    providerCorrelationId: 'trace-13034',
  });

  assert.deepEqual(travelportStaysCreateOutcomeToSubmissionOutcome({
    status: 'AMBIGUOUS',
    failureCode: 'INVALID_RESPONSE',
    supplierConfirmationReference: null,
    providerCorrelationId: 'trace-invalid',
  }), {
    status: 'AMBIGUOUS',
    failureCode: 'INVALID_RESPONSE',
    supplierConfirmationReference: null,
    providerCorrelationId: 'trace-invalid',
  });
});

test('preserves documented definitive provider validation failures and retryability', () => {
  assert.deepEqual(travelportStaysCreateOutcomeToSubmissionOutcome({
    status: 'FAILED',
    failureCode: 'TRAVELPORT_VALIDATION_13046',
    retryable: false,
    providerCorrelationId: 'trace-3',
  }), {
    status: 'FAILED',
    failureCode: 'TRAVELPORT_VALIDATION_13046',
    retryable: false,
    providerCorrelationId: 'trace-3',
  });

  assert.deepEqual(travelportStaysCreateOutcomeToSubmissionOutcome({
    status: 'FAILED',
    failureCode: 'TRAVELPORT_VALIDATION_1541',
    retryable: true,
    providerCorrelationId: 'trace-4',
  }), {
    status: 'FAILED',
    failureCode: 'TRAVELPORT_VALIDATION_1541',
    retryable: true,
    providerCorrelationId: 'trace-4',
  });
});

test('refuses to collapse price or guarantee review outcomes into generic failure settlement', () => {
  for (const reason of ['PRICE_CHANGED', 'GUARANTEE_CHANGED', 'PRICE_AND_GUARANTEE_CHANGED'] as const) {
    assert.throws(
      () => travelportStaysCreateOutcomeToSubmissionOutcome({
        status: 'REVIEW_REQUIRED',
        reason,
        providerCorrelationId: 'trace-5',
      }),
      /dedicated durable review settlement path/,
    );
  }
});
