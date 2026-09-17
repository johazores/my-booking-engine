import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRentalSecurityBondRequirementIdempotencyKey,
  buildRentalSecurityBondTransactionIdempotencyKey,
  deriveRentalSecurityBondSettlement,
} from './rental-security-bond-domain.ts';

const now = new Date('2026-09-17T02:00:00.000Z');

test('security bond reconciles requirement, collection, and release', () => {
  const required = deriveRentalSecurityBondSettlement({ requiredAmountMinor: 50000n, currency: 'PHP', transactions: [] });
  assert.deepEqual(required, { reconciled: true, state: 'REQUIRED', collectedMinor: 0n, releasedMinor: 0n, netHeldMinor: 0n, sourceProviderReference: null });

  const collection = { kind: 'OFFLINE_PAYMENT' as const, status: 'SUCCEEDED' as const, providerCode: 'manual', providerReference: 'BOND-1', sourceProviderReference: null, currency: 'PHP', amountMinor: 50000n, createdAt: now };
  const collected = deriveRentalSecurityBondSettlement({ requiredAmountMinor: 50000n, currency: 'PHP', transactions: [collection] });
  assert.equal(collected.reconciled && collected.state, 'COLLECTED');

  const released = deriveRentalSecurityBondSettlement({
    requiredAmountMinor: 50000n,
    currency: 'PHP',
    transactions: [collection, { ...collection, kind: 'REFUND', providerReference: 'RELEASE-1', sourceProviderReference: 'BOND-1', createdAt: new Date(now.getTime() + 1) }],
  });
  assert.equal(released.reconciled && released.state, 'RELEASED');
  assert.equal(released.reconciled && released.netHeldMinor, 0n);
});

test('security bond reconciliation fails closed on partial, duplicate, or invalid release evidence', () => {
  const collection = { kind: 'OFFLINE_PAYMENT' as const, status: 'SUCCEEDED' as const, providerCode: 'manual', providerReference: 'BOND-1', sourceProviderReference: null, currency: 'PHP', amountMinor: 50000n, createdAt: now };
  assert.equal(deriveRentalSecurityBondSettlement({ requiredAmountMinor: 50000n, currency: 'PHP', transactions: [{ ...collection, amountMinor: 1n }] }).reconciled, false);
  assert.equal(deriveRentalSecurityBondSettlement({ requiredAmountMinor: 50000n, currency: 'PHP', transactions: [collection, { ...collection, providerReference: 'BOND-2' }] }).reconciled, false);
  assert.equal(deriveRentalSecurityBondSettlement({ requiredAmountMinor: 50000n, currency: 'PHP', transactions: [collection, { ...collection, kind: 'REFUND', providerReference: 'RELEASE-1', sourceProviderReference: 'WRONG' }] }).reconciled, false);
});

test('security bond idempotency is deterministic and operation-scoped', () => {
  const requirement = buildRentalSecurityBondRequirementIdempotencyKey({ bookingId: 'b', currency: 'PHP', amountMinor: 50000n });
  assert.match(requirement, /^rental-bond:requirement:[a-f0-9]{48}$/);
  const collection = buildRentalSecurityBondTransactionIdempotencyKey({ kind: 'manual-collection', bondId: 'bond', reference: 'REF-1' });
  const release = buildRentalSecurityBondTransactionIdempotencyKey({ kind: 'manual-release', bondId: 'bond', reference: 'REF-1' });
  assert.match(collection, /^rental-bond:manual-collection:[a-f0-9]{48}$/);
  assert.match(release, /^rental-bond:manual-release:[a-f0-9]{48}$/);
  assert.notEqual(collection, release);
});
