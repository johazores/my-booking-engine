import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HOSPITALITY_SUPPLIER_RESERVATION_ATTEMPT_LEASE_MS,
  assertHospitalitySupplierReservationAttemptLeaseExpired,
  deriveHospitalitySupplierReservationExpiredAttemptRecovery,
} from './hospitality-supplier-reservation-attempt-lease.ts';

test('recovery writes are valid SUBMITTING attempts but not RECONCILING attempts', () => {
  const startedAt = new Date('2026-09-07T00:00:00.000Z');
  const now = new Date(startedAt.getTime() + HOSPITALITY_SUPPLIER_RESERVATION_ATTEMPT_LEASE_MS);
  assert.doesNotThrow(() => assertHospitalitySupplierReservationAttemptLeaseExpired({
    operationStatus: 'SUBMITTING',
    attemptKind: 'RECOVERY_WRITE',
    attemptStatus: 'STARTED',
    attemptSequence: 2,
    currentAttemptCount: 2,
    startedAt,
    now,
  }));
  assert.throws(() => assertHospitalitySupplierReservationAttemptLeaseExpired({
    operationStatus: 'RECONCILING',
    attemptKind: 'RECOVERY_WRITE',
    attemptStatus: 'STARTED',
    attemptSequence: 2,
    currentAttemptCount: 2,
    startedAt,
    now,
  }));
});

test('stale recovery write is retryable only before the durable provider-request marker', () => {
  assert.deepEqual(deriveHospitalitySupplierReservationExpiredAttemptRecovery({
    attemptKind: 'RECOVERY_WRITE',
    providerRequestStarted: false,
  }), {
    operationStatus: 'AMBIGUOUS',
    attemptStatus: 'FAILED',
    failureCode: 'EXECUTION_LEASE_EXPIRED_BEFORE_PROVIDER_REQUEST',
    retryable: true,
  });
  assert.deepEqual(deriveHospitalitySupplierReservationExpiredAttemptRecovery({
    attemptKind: 'RECOVERY_WRITE',
    providerRequestStarted: true,
  }), {
    operationStatus: 'AMBIGUOUS',
    attemptStatus: 'AMBIGUOUS',
    failureCode: 'EXECUTION_LEASE_EXPIRED',
    retryable: null,
  });
});
