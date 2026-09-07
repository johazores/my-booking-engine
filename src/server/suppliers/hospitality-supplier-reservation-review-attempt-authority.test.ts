import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierReservationConflictError } from './hospitality-supplier-reservation-domain.ts';
import { assertHospitalitySupplierReservationReviewAttemptAuthority } from './hospitality-supplier-reservation-review-attempt-authority.ts';

const providerStartedAt = new Date('2026-09-07T10:00:00.000Z');
const completedAt = new Date('2026-09-07T10:00:01.000Z');

function input(overrides: Record<string, unknown> = {}) {
  return {
    reservation: {
      status: 'REVIEW_REQUIRED',
      attemptCount: 2,
      lastFailureCode: 'SUPPLIER_PRICE_CHANGED',
    },
    attempt: {
      sequence: 2,
      kind: 'CREATE',
      status: 'REVIEW_REQUIRED',
      normalizedFailureCode: 'SUPPLIER_PRICE_CHANGED',
      providerRequestStartedAt: providerStartedAt,
      completedAt,
    },
    ...overrides,
  } as Parameters<typeof assertHospitalitySupplierReservationReviewAttemptAuthority>[0];
}

test('accepts only the exact current marked create review attempt', () => {
  const authority = assertHospitalitySupplierReservationReviewAttemptAuthority(input());
  assert.deepEqual(authority, {
    reason: 'SUPPLIER_PRICE_CHANGED',
    acceptPriceChange: true,
    acceptGuaranteeChange: false,
  });
});

test('rejects absent, stale, wrong-kind, incomplete, or unmarked review evidence', () => {
  for (const value of [
    input({ attempt: null }),
    input({ attempt: { ...input().attempt!, sequence: 1 } }),
    input({ attempt: { ...input().attempt!, kind: 'RECOVERY_WRITE' } }),
    input({ attempt: { ...input().attempt!, status: 'FAILED' } }),
    input({ attempt: { ...input().attempt!, normalizedFailureCode: 'SUPPLIER_GUARANTEE_CHANGED' } }),
    input({ attempt: { ...input().attempt!, providerRequestStartedAt: null } }),
    input({ attempt: { ...input().attempt!, completedAt: null } }),
  ]) {
    assert.throws(
      () => assertHospitalitySupplierReservationReviewAttemptAuthority(value),
      HospitalitySupplierReservationConflictError,
    );
  }
});

test('rejects malformed sequencing and invalid durable timestamps', () => {
  assert.throws(
    () => assertHospitalitySupplierReservationReviewAttemptAuthority(input({
      reservation: { ...input().reservation, attemptCount: 0 },
    })),
    /sequence is invalid/,
  );
  assert.throws(
    () => assertHospitalitySupplierReservationReviewAttemptAuthority(input({
      attempt: { ...input().attempt!, completedAt: new Date('invalid') },
    })),
    HospitalitySupplierReservationConflictError,
  );
});

test('preserves exact price, guarantee, and combined review dimensions', () => {
  for (const [reason, expected] of [
    ['SUPPLIER_PRICE_CHANGED', [true, false]],
    ['SUPPLIER_GUARANTEE_CHANGED', [false, true]],
    ['SUPPLIER_PRICE_AND_GUARANTEE_CHANGED', [true, true]],
  ] as const) {
    const authority = assertHospitalitySupplierReservationReviewAttemptAuthority(input({
      reservation: { ...input().reservation, lastFailureCode: reason },
      attempt: { ...input().attempt!, normalizedFailureCode: reason },
    }));
    assert.deepEqual([authority.acceptPriceChange, authority.acceptGuaranteeChange], expected);
  }
});
