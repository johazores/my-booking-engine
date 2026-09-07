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

test('turns documented sell changes into fixed non-retryable ledger failures', () => {
  const expected = [
    ['PRICE_CHANGED', 'SUPPLIER_PRICE_CHANGED'],
    ['GUARANTEE_CHANGED', 'SUPPLIER_GUARANTEE_CHANGED'],
    ['PRICE_AND_GUARANTEE_CHANGED', 'SUPPLIER_PRICE_AND_GUARANTEE_CHANGED'],
  ] as const;

  for (const [reason, failureCode] of expected) {
    assert.deepEqual(travelportStaysCreateOutcomeToSubmissionOutcome({
      status: 'REVIEW_REQUIRED',
      reason,
      providerCorrelationId: 'trace-5',
    }), {
      status: 'FAILED',
      failureCode,
      retryable: false,
      providerCorrelationId: 'trace-5',
    });
  }
});
