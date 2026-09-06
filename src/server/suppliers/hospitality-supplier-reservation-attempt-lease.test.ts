import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HOSPITALITY_SUPPLIER_RESERVATION_ATTEMPT_LEASE_MS,
  HOSPITALITY_SUPPLIER_RESERVATION_PRE_PROVIDER_LEASE_EXPIRED_FAILURE_CODE,
  HOSPITALITY_SUPPLIER_RESERVATION_PROVIDER_LEASE_EXPIRED_FAILURE_CODE,
  HospitalitySupplierReservationAttemptLeaseConflictError,
  assertHospitalitySupplierReservationAttemptLeaseExpired,
  deriveHospitalitySupplierReservationExpiredAttemptRecovery,
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

test('stale create before provider request is safe to retry while stale reconciliation stays ambiguous', () => {
  assert.deepEqual(
    deriveHospitalitySupplierReservationExpiredAttemptRecovery({
      attemptKind: 'CREATE',
      providerRequestStarted: false,
    }),
    {
      operationStatus: 'PREPARED',
      attemptStatus: 'FAILED',
      failureCode: HOSPITALITY_SUPPLIER_RESERVATION_PRE_PROVIDER_LEASE_EXPIRED_FAILURE_CODE,
      retryable: true,
    },
  );
  assert.deepEqual(
    deriveHospitalitySupplierReservationExpiredAttemptRecovery({
      attemptKind: 'RECONCILE',
      providerRequestStarted: false,
    }),
    {
      operationStatus: 'AMBIGUOUS',
      attemptStatus: 'FAILED',
      failureCode: HOSPITALITY_SUPPLIER_RESERVATION_PRE_PROVIDER_LEASE_EXPIRED_FAILURE_CODE,
      retryable: null,
    },
  );
});

test('provider-request marker makes either stale attempt fail closed to ambiguity', () => {
  for (const attemptKind of ['CREATE', 'RECONCILE'] as const) {
    assert.deepEqual(
      deriveHospitalitySupplierReservationExpiredAttemptRecovery({
        attemptKind,
        providerRequestStarted: true,
      }),
      {
        operationStatus: 'AMBIGUOUS',
        attemptStatus: 'AMBIGUOUS',
        failureCode: HOSPITALITY_SUPPLIER_RESERVATION_PROVIDER_LEASE_EXPIRED_FAILURE_CODE,
        retryable: null,
      },
    );
  }
});
