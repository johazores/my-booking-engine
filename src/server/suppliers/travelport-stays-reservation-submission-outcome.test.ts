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

test('keeps uncertain supplier evidence ambiguous and never invents retryability', () => {
  assert.deepEqual(travelportStaysCreateOutcomeToSubmissionOutcome({
    status: 'AMBIGUOUS',
    failureCode: 'TRAVELPORT_SYNC_REQUIRED',
    supplierConfirmationReference: 'T9RY0-WQ842',
    providerCorrelationId: 'trace-2',
  }), {
    status: 'AMBIGUOUS',
    failureCode: 'TRAVELPORT_SYNC_REQUIRED',
    supplierConfirmationReference: 'T9RY0-WQ842',
    providerCorrelationId: 'trace-2',
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
