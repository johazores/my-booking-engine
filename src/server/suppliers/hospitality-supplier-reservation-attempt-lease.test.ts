import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HOSPITALITY_SUPPLIER_RESERVATION_ATTEMPT_LEASE_MS,
  HospitalitySupplierReservationAttemptLeaseConflictError,
  assertHospitalitySupplierReservationAttemptLeaseExpired,
} from './hospitality-supplier-reservation-attempt-lease.ts';

const startedAt = new Date('2026-09-06T00:00:00.000Z');

function input(overrides: Partial<Parameters<typeof assertHospitalitySupplierReservationAttemptLeaseExpired>[0]> = {}) {
  return {
    operationStatus: 'SUBMITTING' as const,
    attemptKind: 'CREATE' as const,
    attemptStatus: 'STARTED' as const,
    attemptSequence: 2,
    currentAttemptCount: 2,
    startedAt,
    now: new Date(startedAt.getTime() + HOSPITALITY_SUPPLIER_RESERVATION_ATTEMPT_LEASE_MS),
    ...overrides,
  };
}

test('supplier reservation execution lease is longer than current provider request ceilings', () => {
  assert.equal(HOSPITALITY_SUPPLIER_RESERVATION_ATTEMPT_LEASE_MS, 600_000);
  assert.ok(HOSPITALITY_SUPPLIER_RESERVATION_ATTEMPT_LEASE_MS > 120_000);
});

test('submission and reconciliation claims become recoverable only after the fixed lease expires', () => {
  assert.throws(
    () => assertHospitalitySupplierReservationAttemptLeaseExpired(input({
      now: new Date(startedAt.getTime() + HOSPITALITY_SUPPLIER_RESERVATION_ATTEMPT_LEASE_MS - 1),
    })),
    /within its execution lease/,
  );
  assert.doesNotThrow(() => assertHospitalitySupplierReservationAttemptLeaseExpired(input()));
  assert.doesNotThrow(() => assertHospitalitySupplierReservationAttemptLeaseExpired(input({
    operationStatus: 'RECONCILING',
    attemptKind: 'RECONCILE',
  })));
});

test('stale recovery rejects mismatched, completed, non-current, or future attempts', () => {
  assert.throws(
    () => assertHospitalitySupplierReservationAttemptLeaseExpired(input({ attemptKind: 'RECONCILE' })),
    HospitalitySupplierReservationAttemptLeaseConflictError,
  );
  assert.throws(
    () => assertHospitalitySupplierReservationAttemptLeaseExpired(input({ attemptStatus: 'AMBIGUOUS' })),
    HospitalitySupplierReservationAttemptLeaseConflictError,
  );
  assert.throws(
    () => assertHospitalitySupplierReservationAttemptLeaseExpired(input({ attemptSequence: 1 })),
    /no longer current/,
  );
  assert.throws(
    () => assertHospitalitySupplierReservationAttemptLeaseExpired(input({ now: new Date(startedAt.getTime() - 1) })),
    /within its execution lease/,
  );
});
