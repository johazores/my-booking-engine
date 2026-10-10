import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCustomerSettlementEntries, PaymentReceiptEvidenceError, sanitizeSuccessfulPaymentTransactions, summarizeSuccessfulPaymentActivity } from './payment-receipt-domain.ts';

function payment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'first', kind: 'CAPTURE' as const, status: 'SUCCEEDED',
    providerCode: 'stripe', providerReference: 'pi_first',
    sourceProviderReference: null, currency: 'AUD',
    amountMinor: 11000n, createdAt: new Date('2026-10-01T00:00:00Z'),
    ...overrides,
  };
}

test('authorization fallback and captured authorization share the same refund source', () => {
  const authorization = payment({ kind: 'AUTHORIZATION' });
  const refund = payment({ id: 'refund', kind: 'REFUND', providerReference: 're_1', sourceProviderReference: 'pi_first', amountMinor: 1000n });
  assert.doesNotThrow(() => sanitizeSuccessfulPaymentTransactions([authorization, refund], 'AUD'));
  assert.doesNotThrow(() => sanitizeSuccessfulPaymentTransactions([authorization, payment({ id: 'capture' }), refund], 'AUD'));
  assert.throws(() => sanitizeSuccessfulPaymentTransactions([authorization, payment({ id: 'capture', providerReference: 'pi_other' }), refund], 'AUD'), PaymentReceiptEvidenceError);
});

test('invalid successful payment money and provider identity fail closed', () => {
  for (const invalid of [
    { amountMinor: '11000' }, { kind: 'OTHER' },
    { id: '' }, { createdAt: new Date('invalid') },
    { providerReference: ' sf_claim_pending' },
    { providerReference: ' pi_first' }, { providerCode: ' stripe' },
    { sourceProviderReference: 'pi_first' },
  ]) {
    assert.throws(() => sanitizeSuccessfulPaymentTransactions([payment(invalid)], 'AUD'), PaymentReceiptEvidenceError);
  }
  assert.throws(() => sanitizeSuccessfulPaymentTransactions([
    payment(), payment({ providerReference: 'pi_second' }),
  ], 'AUD'), PaymentReceiptEvidenceError);
});

test('direct authorization settlement and activity use the latest successful timestamp, not input order', () => {
  const latest = payment({ id: 'latest', kind: 'AUTHORIZATION', providerReference: 'pi_latest', amountMinor: 9000n, createdAt: new Date('2026-10-03T00:00:00Z') });
  const earlier = payment({ id: 'earlier', kind: 'AUTHORIZATION', providerReference: 'pi_earlier', amountMinor: 5000n, createdAt: new Date('2026-10-01T00:00:00Z') });
  const refund = payment({ id: 'refund', kind: 'REFUND', providerReference: 're_latest', sourceProviderReference: 'pi_latest', amountMinor: 1000n, createdAt: new Date('2026-10-04T00:00:00Z') });
  for (const order of [[latest, refund, earlier], [refund, earlier, latest]]) {
    const rows = sanitizeSuccessfulPaymentTransactions(order, 'AUD');
    assert.deepEqual(rows.map((row) => row.id), ['earlier', 'latest', 'refund']);
    assert.deepEqual(summarizeSuccessfulPaymentActivity(rows, 'PARTIALLY_REFUNDED'), { capturedMinor: 9000n, refundedMinor: 1000n, netPaidMinor: 8000n });
    assert.deepEqual(buildCustomerSettlementEntries(rows, 'PARTIALLY_REFUNDED').map((row) => [row.kind, row.amountMinor]), [['PAYMENT', 9000n], ['REFUND', 1000n]]);
  }
  assert.throws(() => sanitizeSuccessfulPaymentTransactions([latest, earlier, { ...refund, sourceProviderReference: 'pi_earlier' }], 'AUD'), PaymentReceiptEvidenceError);
});

test('same-time authorizations select a stable ID and show payments before refunds', () => {
  const when = new Date('2026-10-03T00:00:00Z');
  const a = payment({ id: 'a', kind: 'AUTHORIZATION', providerReference: 'pi_a', amountMinor: 4000n, createdAt: when });
  const z = payment({ id: 'z', kind: 'AUTHORIZATION', providerReference: 'pi_z', amountMinor: 9000n, createdAt: when });
  const refund = payment({ id: 'r', kind: 'REFUND', providerReference: 're_z', sourceProviderReference: 'pi_z', amountMinor: 1000n, createdAt: when });
  const rows = sanitizeSuccessfulPaymentTransactions([z, refund, a], 'AUD');
  assert.deepEqual(rows.map((row) => row.id), ['a', 'r', 'z']);
  assert.equal(summarizeSuccessfulPaymentActivity(rows, 'PARTIALLY_REFUNDED').capturedMinor, 9000n);
  assert.deepEqual(buildCustomerSettlementEntries(rows, 'PARTIALLY_REFUNDED').map((row) => row.kind), ['PAYMENT', 'REFUND']);
});

test('same-time multiple captures appear before refunds in customer activity', () => {
  const when = new Date('2026-10-03T00:00:00Z');
  const a = payment({ id: 'a', providerReference: 'pi_a', amountMinor: 1000n, createdAt: when });
  const z = payment({ id: 'z', providerReference: 'pi_z', amountMinor: 2000n, createdAt: when });
  const refund = payment({ id: 'r', kind: 'REFUND', providerReference: 're_z', sourceProviderReference: 'pi_z', amountMinor: 500n, createdAt: when });
  for (const order of [[refund, z, a], [a, refund, z]]) {
    const rows = sanitizeSuccessfulPaymentTransactions(order, 'AUD');
    assert.deepEqual(buildCustomerSettlementEntries(rows, 'PARTIALLY_REFUNDED').map((row) => [row.kind, row.amountMinor]), [
      ['PAYMENT', 1000n], ['PAYMENT', 2000n], ['REFUND', 500n],
    ]);
  }
});

test('later successful authorization holds cannot advance monetary receipt activity', () => {
  const capture = payment({ id: 'capture', providerReference: 'pi_paid', amountMinor: 9000n, createdAt: new Date('2026-10-01T00:00:00Z') });
  const refund = payment({ id: 'refund', kind: 'REFUND', providerReference: 're_paid', sourceProviderReference: 'pi_paid', amountMinor: 1000n, createdAt: new Date('2026-10-02T00:00:00Z') });
  const laterHold = payment({ id: 'later-hold', kind: 'AUTHORIZATION', providerReference: 'pi_later', createdAt: new Date('2026-10-09T00:00:00Z') });
  const rows = sanitizeSuccessfulPaymentTransactions([laterHold, refund, capture], 'AUD');
  assert.equal(rows.at(-1)?.id, 'later-hold');
  const activity = buildCustomerSettlementEntries(rows, 'PARTIALLY_REFUNDED');
  assert.deepEqual(activity.map((entry) => [entry.kind, entry.createdAt.toISOString()]), [
    ['PAYMENT', '2026-10-01T00:00:00.000Z'],
    ['REFUND', '2026-10-02T00:00:00.000Z'],
  ]);
  assert.equal(activity.at(-1)?.createdAt.toISOString(), '2026-10-02T00:00:00.000Z');
});
