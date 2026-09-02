import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveBookingSettlementSummary,
  type BookingSettlementTransaction,
} from './payment-settlement-domain.ts';

function transaction(overrides: Partial<BookingSettlementTransaction> = {}): BookingSettlementTransaction {
  return {
    kind: 'CAPTURE',
    status: 'SUCCEEDED',
    providerCode: 'stripe',
    providerReference: 'pi_123',
    currency: 'AUD',
    amountMinor: 10_000n,
    ...overrides,
  };
}

test('aggregates multiple same-provider settlement sources and refunds into authoritative net settled money', () => {
  const result = deriveBookingSettlementSummary({
    currency: 'AUD',
    transactions: [
      transaction({ providerReference: 'pi_1', amountMinor: 10_000n }),
      transaction({ providerReference: 'pi_2', amountMinor: 2_500n }),
      transaction({ kind: 'REFUND', providerReference: 're_1', amountMinor: 1_500n }),
    ],
  });

  assert.equal(result.reconciled, true);
  if (!result.reconciled) return;
  assert.equal(result.grossSettledMinor, 12_500n);
  assert.equal(result.refundedMinor, 1_500n);
  assert.equal(result.netSettledMinor, 11_000n);
  assert.deepEqual(result.providers, [{
    providerCode: 'stripe',
    grossSettledMinor: 12_500n,
    refundedMinor: 1_500n,
    netSettledMinor: 11_000n,
    sourceCount: 2,
  }]);
});

test('counts a captured authorization only once', () => {
  const result = deriveBookingSettlementSummary({
    currency: 'AUD',
    transactions: [
      transaction({ kind: 'AUTHORIZATION', providerReference: 'pi_same' }),
      transaction({ kind: 'CAPTURE', providerReference: 'pi_same' }),
    ],
  });

  assert.equal(result.reconciled, true);
  if (!result.reconciled) return;
  assert.equal(result.grossSettledMinor, 10_000n);
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0]?.kind, 'CAPTURE');
});

test('keeps independent payment providers separate while reconciling the booking total', () => {
  const result = deriveBookingSettlementSummary({
    currency: 'AUD',
    transactions: [
      transaction({ providerCode: 'manual', kind: 'OFFLINE_PAYMENT', providerReference: 'receipt-1', amountMinor: 4_000n }),
      transaction({ providerReference: 'pi_2', amountMinor: 6_000n }),
    ],
  });

  assert.equal(result.reconciled, true);
  if (!result.reconciled) return;
  assert.equal(result.netSettledMinor, 10_000n);
  assert.deepEqual(result.providers.map((provider) => provider.providerCode), ['manual', 'stripe']);
});

test('fails closed while any payment operation is unresolved', () => {
  const result = deriveBookingSettlementSummary({
    currency: 'AUD',
    transactions: [transaction(), transaction({ kind: 'REFUND', status: 'AMBIGUOUS', providerReference: 'sf_claim_retry' })],
  });
  assert.deepEqual(result, {
    reconciled: false,
    reason: 'A payment operation is still unresolved. Reconcile payment history before continuing.',
  });
});

test('fails closed when a successful provider claim was never reconciled to an external reference', () => {
  const result = deriveBookingSettlementSummary({
    currency: 'AUD',
    transactions: [transaction({ providerReference: `sf_claim_${'a'.repeat(64)}` })],
  });
  assert.equal(result.reconciled, false);
  if (result.reconciled) return;
  assert.match(result.reason, /internal provider claim/i);
});

test('fails closed when successful history contains another currency', () => {
  const result = deriveBookingSettlementSummary({
    currency: 'AUD',
    transactions: [transaction({ currency: 'USD' })],
  });
  assert.equal(result.reconciled, false);
  if (result.reconciled) return;
  assert.match(result.reason, /different currency/i);
});

test('fails closed when refunds exceed settled money for their provider', () => {
  const result = deriveBookingSettlementSummary({
    currency: 'AUD',
    transactions: [transaction({ amountMinor: 5_000n }), transaction({ kind: 'REFUND', providerReference: 're_1', amountMinor: 5_001n })],
  });
  assert.equal(result.reconciled, false);
  if (result.reconciled) return;
  assert.match(result.reason, /exceeds settled money/i);
});

test('fails closed on duplicate successful settlement references', () => {
  const result = deriveBookingSettlementSummary({
    currency: 'AUD',
    transactions: [transaction(), transaction()],
  });
  assert.equal(result.reconciled, false);
  if (result.reconciled) return;
  assert.match(result.reason, /duplicate settlement reference/i);
});

test('fails closed on duplicate successful refund references', () => {
  const result = deriveBookingSettlementSummary({
    currency: 'AUD',
    transactions: [
      transaction(),
      transaction({ kind: 'REFUND', providerReference: 're_dup', amountMinor: 1_000n }),
      transaction({ kind: 'REFUND', providerReference: 're_dup', amountMinor: 1_000n }),
    ],
  });
  assert.equal(result.reconciled, false);
  if (result.reconciled) return;
  assert.match(result.reason, /duplicate refund reference/i);
});
