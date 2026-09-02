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
    sourceProviderReference: null,
    currency: 'AUD',
    amountMinor: 10_000n,
    ...overrides,
  };
}

test('aggregates multiple same-provider settlement sources with explicit refund attribution', () => {
  const result = deriveBookingSettlementSummary({
    currency: 'AUD',
    transactions: [
      transaction({ providerReference: 'pi_1', amountMinor: 10_000n }),
      transaction({ providerReference: 'pi_2', amountMinor: 2_500n }),
      transaction({
        kind: 'REFUND',
        providerReference: 're_1',
        sourceProviderReference: 'pi_1',
        amountMinor: 1_500n,
      }),
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
  assert.deepEqual(result.sources.map((source) => ({
    providerReference: source.providerReference,
    refundedMinor: source.refundedMinor,
    remainingMinor: source.remainingMinor,
  })), [
    { providerReference: 'pi_1', refundedMinor: 1_500n, remainingMinor: 8_500n },
    { providerReference: 'pi_2', refundedMinor: 0n, remainingMinor: 2_500n },
  ]);
});

test('keeps legacy unattributed refunds reconciled when the provider has exactly one settlement source', () => {
  const result = deriveBookingSettlementSummary({
    currency: 'AUD',
    transactions: [
      transaction({ providerReference: 'pi_legacy' }),
      transaction({ kind: 'REFUND', providerReference: 're_legacy', amountMinor: 2_000n }),
    ],
  });

  assert.equal(result.reconciled, true);
  if (!result.reconciled) return;
  assert.equal(result.sources[0]?.refundedMinor, 2_000n);
  assert.equal(result.sources[0]?.remainingMinor, 8_000n);
});

test('fails closed when a legacy refund lacks source attribution across multiple settlement sources', () => {
  const result = deriveBookingSettlementSummary({
    currency: 'AUD',
    transactions: [
      transaction({ providerReference: 'pi_1', amountMinor: 5_000n }),
      transaction({ providerReference: 'pi_2', amountMinor: 5_000n }),
      transaction({ kind: 'REFUND', providerReference: 're_legacy', amountMinor: 1_000n }),
    ],
  });

  assert.equal(result.reconciled, false);
  if (result.reconciled) return;
  assert.match(result.reason, /missing settlement-source attribution/i);
});

test('fails closed when a refund references a missing settlement source', () => {
  const result = deriveBookingSettlementSummary({
    currency: 'AUD',
    transactions: [
      transaction({ providerReference: 'pi_real' }),
      transaction({
        kind: 'REFUND',
        providerReference: 're_wrong',
        sourceProviderReference: 'pi_missing',
        amountMinor: 1_000n,
      }),
    ],
  });

  assert.equal(result.reconciled, false);
  if (result.reconciled) return;
  assert.match(result.reason, /source that is not present/i);
});

test('fails closed when refunds exceed the attributed settlement source even if provider gross is sufficient', () => {
  const result = deriveBookingSettlementSummary({
    currency: 'AUD',
    transactions: [
      transaction({ providerReference: 'pi_small', amountMinor: 2_000n }),
      transaction({ providerReference: 'pi_large', amountMinor: 10_000n }),
      transaction({
        kind: 'REFUND',
        providerReference: 're_over',
        sourceProviderReference: 'pi_small',
        amountMinor: 2_001n,
      }),
    ],
  });

  assert.equal(result.reconciled, false);
  if (result.reconciled) return;
  assert.match(result.reason, /exceeds settled money for its payment source/i);
});

test('counts a captured authorization only once and preserves refund attribution to the captured reference', () => {
  const result = deriveBookingSettlementSummary({
    currency: 'AUD',
    transactions: [
      transaction({ kind: 'AUTHORIZATION', providerReference: 'pi_same' }),
      transaction({ kind: 'CAPTURE', providerReference: 'pi_same' }),
      transaction({
        kind: 'REFUND',
        providerReference: 're_same',
        sourceProviderReference: 'pi_same',
        amountMinor: 1_000n,
      }),
    ],
  });

  assert.equal(result.reconciled, true);
  if (!result.reconciled) return;
  assert.equal(result.grossSettledMinor, 10_000n);
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0]?.kind, 'CAPTURE');
  assert.equal(result.sources[0]?.refundedMinor, 1_000n);
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

test('fails closed when refund-source attribution appears on a non-refund transaction', () => {
  const result = deriveBookingSettlementSummary({
    currency: 'AUD',
    transactions: [transaction({ sourceProviderReference: 'pi_other' })],
  });
  assert.equal(result.reconciled, false);
  if (result.reconciled) return;
  assert.match(result.reason, /non-refund/i);
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
