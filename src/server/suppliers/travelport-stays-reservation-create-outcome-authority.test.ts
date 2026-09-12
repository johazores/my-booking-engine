import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import {
  materializeTravelportStaysReservationCreateOutcome,
  materializeTravelportStaysReservationSyncOutcome,
} from './travelport-stays-reservation-create-outcome-authority.ts';

function assertInvalidResult(callback: () => unknown) {
  assert.throws(callback, (error: unknown) => {
    assert.ok(error instanceof HospitalitySupplierProviderError);
    assert.equal(error.code, 'INVALID_RESPONSE');
    assert.equal(error.message, 'Travelport reservation write outcome could not be materialized safely.');
    return true;
  });
}

test('materializes and freezes canonical create outcomes branch by branch', () => {
  const confirmed = materializeTravelportStaysReservationCreateOutcome({
    status: 'CONFIRMED',
    providerReservationReference: 'PNR-1',
    supplierConfirmationReference: 'SUP-1',
    providerCorrelationId: 'trace-1',
  });
  assert.deepEqual(confirmed, {
    status: 'CONFIRMED',
    providerReservationReference: 'PNR-1',
    supplierConfirmationReference: 'SUP-1',
    providerCorrelationId: 'trace-1',
  });
  assert.equal(Object.isFrozen(confirmed), true);

  assert.deepEqual(materializeTravelportStaysReservationCreateOutcome({
    status: 'FAILED', failureCode: 'TRAVELPORT_VALIDATION_13050', retryable: true, providerCorrelationId: null,
  }), {
    status: 'FAILED', failureCode: 'TRAVELPORT_VALIDATION_13050', retryable: true, providerCorrelationId: null,
  });
  assert.deepEqual(materializeTravelportStaysReservationCreateOutcome({
    status: 'REVIEW_REQUIRED', reason: 'PRICE_AND_GUARANTEE_CHANGED', providerCorrelationId: 'trace-2',
  }), {
    status: 'REVIEW_REQUIRED', reason: 'PRICE_AND_GUARANTEE_CHANGED', providerCorrelationId: 'trace-2',
  });
  assert.deepEqual(materializeTravelportStaysReservationCreateOutcome({
    status: 'AMBIGUOUS', failureCode: 'TRAVELPORT_SYNC_REQUIRED', supplierConfirmationReference: 'SUP-2', providerCorrelationId: null,
  }), {
    status: 'AMBIGUOUS', failureCode: 'TRAVELPORT_SYNC_REQUIRED', supplierConfirmationReference: 'SUP-2', providerRecoveryReference: null, providerCorrelationId: null,
  });
});

test('materializes sync outcomes without trusting caller-owned result objects', () => {
  const source = {
    status: 'CONFIRMED',
    providerReservationReference: 'PNR-2',
    supplierConfirmationReference: 'SUP-3',
    providerCorrelationId: 'trace-3',
  };
  const snapshot = materializeTravelportStaysReservationSyncOutcome(source);
  source.providerReservationReference = 'PNR-MUTATED';
  assert.equal(snapshot.providerReservationReference, 'PNR-2');
  assert.equal(Object.isFrozen(snapshot), true);
  assert.deepEqual(materializeTravelportStaysReservationSyncOutcome({
    status: 'AMBIGUOUS', failureCode: 'INVALID_RESPONSE', providerCorrelationId: null,
  }), { status: 'AMBIGUOUS', failureCode: 'INVALID_RESPONSE', providerCorrelationId: null });
});

test('reads relevant create outcome fields exactly once and ignores other branch getters', () => {
  const reads = new Map<string, number>();
  const once = (name: string, value: unknown) => ({
    enumerable: true,
    get() {
      reads.set(name, (reads.get(name) ?? 0) + 1);
      return value;
    },
  });
  const input = Object.defineProperties({}, {
    status: once('status', 'FAILED'),
    failureCode: once('failureCode', 'TRAVELPORT_VALIDATION_13050'),
    retryable: once('retryable', true),
    providerCorrelationId: once('providerCorrelationId', 'trace-4'),
    providerReservationReference: { get() { throw new Error('irrelevant getter executed'); } },
    reason: { get() { throw new Error('irrelevant getter executed'); } },
  });
  const snapshot = materializeTravelportStaysReservationCreateOutcome(input);
  assert.equal(snapshot.status, 'FAILED');
  assert.deepEqual(Object.fromEntries(reads), {
    status: 1, failureCode: 1, retryable: 1, providerCorrelationId: 1,
  });
});

test('sanitizes throwing getters, revoked proxies, and caller-supplied provider errors', () => {
  const throwing = Object.defineProperty({}, 'status', {
    get() { throw new Error('do not leak me'); },
  });
  assertInvalidResult(() => materializeTravelportStaysReservationCreateOutcome(throwing));

  const { proxy, revoke } = Proxy.revocable({ status: 'AMBIGUOUS' }, {});
  revoke();
  assertInvalidResult(() => materializeTravelportStaysReservationCreateOutcome(proxy));

  const hostile = Object.defineProperty({ status: 'FAILED' }, 'failureCode', {
    get() { throw new HospitalitySupplierProviderError('AUTHENTICATION_FAILED', 'caller controlled'); },
  });
  assertInvalidResult(() => materializeTravelportStaysReservationCreateOutcome(hostile));
});

test('rejects malformed create outcome semantics', () => {
  for (const value of [
    null,
    [],
    { status: 'CONFIRMED', providerReservationReference: ' PNR ', supplierConfirmationReference: null, providerCorrelationId: null },
    { status: 'FAILED', failureCode: 'TIMEOUT', retryable: true, providerCorrelationId: null },
    { status: 'FAILED', failureCode: 'TRAVELPORT_VALIDATION_99999999', retryable: false, providerCorrelationId: null },
    { status: 'FAILED', failureCode: 'TRAVELPORT_VALIDATION_13050', retryable: false, providerCorrelationId: null },
    { status: 'FAILED', failureCode: 'TRAVELPORT_VALIDATION_13050', retryable: 'yes', providerCorrelationId: null },
    { status: 'REVIEW_REQUIRED', reason: 'OFFER_CHANGED', providerCorrelationId: null },
    { status: 'AMBIGUOUS', failureCode: 'TIMEOUT', supplierConfirmationReference: null, providerCorrelationId: null },
    { status: 'AMBIGUOUS', failureCode: 'INVALID_RESPONSE', supplierConfirmationReference: '', providerCorrelationId: null },
  ]) assertInvalidResult(() => materializeTravelportStaysReservationCreateOutcome(value));
});

test('rejects malformed sync outcome semantics', () => {
  assertInvalidResult(() => materializeTravelportStaysReservationSyncOutcome({
    status: 'CONFIRMED', providerReservationReference: 'PNR-1', supplierConfirmationReference: null, providerCorrelationId: null,
  }));
  assertInvalidResult(() => materializeTravelportStaysReservationSyncOutcome({
    status: 'AMBIGUOUS', failureCode: 'TRAVELPORT_SYNC_REQUIRED', providerCorrelationId: null,
  }));
});
