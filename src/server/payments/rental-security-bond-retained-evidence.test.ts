import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRentalSecurityBondRequestFingerprint,
  buildRentalSecurityBondTransactionIdempotencyKey,
  isValidRentalSecurityBondRetainedTransaction,
} from './rental-security-bond-domain.ts';

type Row = Readonly<{
  kind: 'OFFLINE_PAYMENT' | 'REFUND';
  status: string;
  providerCode: string;
  providerReference: string;
  sourceProviderReference: string | null;
  currency: string;
  amountMinor: bigint;
  createdAt: Date;
}>;

const organizationId = 'org-1';
const bookingId = 'booking-1';
const bondId = 'bond-1';
const base: Row = {
  kind: 'OFFLINE_PAYMENT',
  status: 'SUCCEEDED',
  providerCode: 'manual',
  providerReference: 'COLLECT-1',
  sourceProviderReference: null,
  currency: 'PHP',
  amountMinor: 15000n,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
};

function retained(row: Row = base) {
  const idempotencyKey = buildRentalSecurityBondTransactionIdempotencyKey({
    kind: row.kind === 'OFFLINE_PAYMENT' ? 'manual-collection' : 'manual-release',
    bondId,
    reference: row.providerReference,
  });
  return {
    ...row,
    idempotencyKey,
    requestFingerprint: buildRentalSecurityBondRequestFingerprint({
      organizationId, bookingId, bondId, idempotencyKey, kind: row.kind,
      providerCode: row.providerCode, providerReference: row.providerReference,
      sourceProviderReference: row.sourceProviderReference, currency: row.currency,
      amountMinor: row.amountMinor,
    }),
  };
}

function valid(transaction: ReturnType<typeof retained>) {
  return isValidRentalSecurityBondRetainedTransaction({ organizationId, bookingId, bondId, transaction });
}

test('accepts canonical collection and release evidence', () => {
  assert.equal(valid(retained()), true);
  assert.equal(valid(retained({
    ...base, kind: 'REFUND', providerReference: 'RELEASE-1', sourceProviderReference: 'COLLECT-1',
  })), true);
});

test('rejects corrupted evidence even when its fingerprint was recomputed', () => {
  const corrupt: Row[] = [
    { ...base, providerReference: ' BAD' },
    { ...base, providerReference: 'sf_claim_fake' },
    { ...base, sourceProviderReference: 'COLLECT-1' },
    { ...base, createdAt: new Date('invalid') },
    { ...base, amountMinor: 0n },
    { ...base, currency: 'php' },
    { ...base, providerCode: 'unknown' },
    { ...base, status: 'FAILED' },
    { ...base, kind: 'REFUND', sourceProviderReference: null },
    { ...base, kind: 'REFUND', sourceProviderReference: 'COLLECT-1', providerReference: 'COLLECT-1' },
  ];
  for (const row of corrupt) assert.equal(valid(retained(row)), false);
});

test('rejects idempotency, fingerprint and tenant-context tampering', () => {
  const row = retained();
  assert.equal(valid({ ...row, idempotencyKey: 'tampered' }), false);
  assert.equal(valid({ ...row, requestFingerprint: 'a'.repeat(64) }), false);
  assert.equal(valid({ ...row, requestFingerprint: 'bad' }), false);
  assert.equal(isValidRentalSecurityBondRetainedTransaction({
    organizationId, bookingId: 'other', bondId, transaction: row,
  }), false);
});
