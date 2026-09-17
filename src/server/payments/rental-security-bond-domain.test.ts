import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRentalSecurityBondForfeitureIdempotencyKey,
  buildRentalSecurityBondRequirementIdempotencyKey,
  buildRentalSecurityBondTransactionIdempotencyKey,
  deriveRentalSecurityBondSettlement,
} from './rental-security-bond-domain.ts';

const now = new Date('2026-09-17T02:00:00.000Z');
const collection = { kind: 'OFFLINE_PAYMENT' as const, status: 'SUCCEEDED' as const, providerCode: 'manual', providerReference: 'BOND-1', sourceProviderReference: null, currency: 'PHP', amountMinor: 50000n, createdAt: now };

test('security bond reconciles requirement, collection, release, and exact forfeiture', () => {
  const required = deriveRentalSecurityBondSettlement({ requiredAmountMinor: 50000n, currency: 'PHP', transactions: [] });
  assert.deepEqual(required, { reconciled: true, state: 'REQUIRED', collectedMinor: 0n, releasedMinor: 0n, forfeitedMinor: 0n, netHeldMinor: 0n, sourceProviderReference: null });

  const collected = deriveRentalSecurityBondSettlement({ requiredAmountMinor: 50000n, currency: 'PHP', transactions: [collection] });
  assert.equal(collected.reconciled && collected.state, 'COLLECTED');

  const released = deriveRentalSecurityBondSettlement({
    requiredAmountMinor: 50000n,
    currency: 'PHP',
    transactions: [collection, { ...collection, kind: 'REFUND', providerReference: 'RELEASE-1', sourceProviderReference: 'BOND-1', createdAt: new Date(now.getTime() + 1) }],
  });
  assert.equal(released.reconciled && released.state, 'RELEASED');
  assert.equal(released.reconciled && released.netHeldMinor, 0n);

  const forfeited = deriveRentalSecurityBondSettlement({
    requiredAmountMinor: 50000n,
    currency: 'PHP',
    transactions: [collection],
    forfeiture: { liabilityDecisionId: 'liability-1', currency: 'PHP', amountMinor: 50000n, createdAt: new Date(now.getTime() + 1) },
  });
  assert.equal(forfeited.reconciled && forfeited.state, 'FORFEITED');
  assert.equal(forfeited.reconciled && forfeited.forfeitedMinor, 50000n);
  assert.equal(forfeited.reconciled && forfeited.netHeldMinor, 0n);
});

test('security bond reconciliation fails closed on partial, duplicate, invalid, or conflicting disposition evidence', () => {
  assert.equal(deriveRentalSecurityBondSettlement({ requiredAmountMinor: 50000n, currency: 'PHP', transactions: [{ ...collection, amountMinor: 1n }] }).reconciled, false);
  assert.equal(deriveRentalSecurityBondSettlement({ requiredAmountMinor: 50000n, currency: 'PHP', transactions: [collection, { ...collection, providerReference: 'BOND-2' }] }).reconciled, false);
  assert.equal(deriveRentalSecurityBondSettlement({ requiredAmountMinor: 50000n, currency: 'PHP', transactions: [collection, { ...collection, kind: 'REFUND', providerReference: 'RELEASE-1', sourceProviderReference: 'WRONG' }] }).reconciled, false);
  assert.equal(deriveRentalSecurityBondSettlement({ requiredAmountMinor: 50000n, currency: 'PHP', transactions: [collection], forfeiture: { liabilityDecisionId: 'liability-1', currency: 'PHP', amountMinor: 1n, createdAt: new Date(now.getTime() + 1) } }).reconciled, false);
  assert.equal(deriveRentalSecurityBondSettlement({ requiredAmountMinor: 50000n, currency: 'PHP', transactions: [collection], forfeiture: { liabilityDecisionId: 'liability-1', currency: 'PHP', amountMinor: 50000n, createdAt: new Date(now.getTime() - 1) } }).reconciled, false);
  assert.equal(deriveRentalSecurityBondSettlement({ requiredAmountMinor: 50000n, currency: 'PHP', transactions: [collection, { ...collection, kind: 'REFUND', providerReference: 'RELEASE-1', sourceProviderReference: 'BOND-1', createdAt: new Date(now.getTime() + 1) }], forfeiture: { liabilityDecisionId: 'liability-1', currency: 'PHP', amountMinor: 50000n, createdAt: new Date(now.getTime() + 2) } }).reconciled, false);
});

test('security bond idempotency is deterministic and operation-scoped', () => {
  const requirement = buildRentalSecurityBondRequirementIdempotencyKey({ bookingId: 'b', currency: 'PHP', amountMinor: 50000n });
  assert.match(requirement, /^rental-bond:requirement:[a-f0-9]{48}$/);
  const collectionKey = buildRentalSecurityBondTransactionIdempotencyKey({ kind: 'manual-collection', bondId: 'bond', reference: 'REF-1' });
  const release = buildRentalSecurityBondTransactionIdempotencyKey({ kind: 'manual-release', bondId: 'bond', reference: 'REF-1' });
  const forfeiture = buildRentalSecurityBondForfeitureIdempotencyKey({ bondId: 'bond', liabilityDecisionId: 'liability' });
  assert.match(collectionKey, /^rental-bond:manual-collection:[a-f0-9]{48}$/);
  assert.match(release, /^rental-bond:manual-release:[a-f0-9]{48}$/);
  assert.match(forfeiture, /^rental-bond:forfeiture:[a-f0-9]{48}$/);
  assert.notEqual(collectionKey, release);
  assert.notEqual(collectionKey, forfeiture);
});
