import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveNextBookingRefundSource } from './payment-refund-allocation-domain.ts';
import type { BookingSettlementSource } from './payment-settlement-domain.ts';

function source(overrides: Partial<BookingSettlementSource> = {}): BookingSettlementSource {
  return {
    kind: 'CAPTURE',
    providerCode: 'stripe',
    providerReference: 'pi_1',
    currency: 'AUD',
    amountMinor: 10_000n,
    refundedMinor: 0n,
    remainingMinor: 10_000n,
    ...overrides,
  };
}

test('allocates a single refundable source', () => {
  assert.deepEqual(deriveNextBookingRefundSource({ sources: [source()] }), {
    allocated: true,
    providerCode: 'stripe',
    providerReference: 'pi_1',
    sourceKind: 'CAPTURE',
    currency: 'AUD',
    sourceRefundableMinor: 10_000n,
    bookingRefundableMinor: 10_000n,
    refundableSourceCount: 1,
  });
});

test('chooses the largest remaining source regardless of input order', () => {
  const small = source({ providerReference: 'pi_small', amountMinor: 4_000n, remainingMinor: 4_000n });
  const large = source({ providerReference: 'pi_large', amountMinor: 8_500n, remainingMinor: 8_500n });
  const first = deriveNextBookingRefundSource({ sources: [small, large] });
  const second = deriveNextBookingRefundSource({ sources: [large, small] });
  assert.equal(first.allocated && first.providerReference, 'pi_large');
  assert.deepEqual(first, second);
});

test('uses provider reference as the deterministic tie breaker', () => {
  const result = deriveNextBookingRefundSource({
    sources: [source({ providerReference: 'pi_b' }), source({ providerReference: 'pi_a' })],
  });
  assert.equal(result.allocated && result.providerReference, 'pi_a');
});

test('ignores fully refunded sources when selecting the next refund', () => {
  const result = deriveNextBookingRefundSource({
    sources: [
      source({ providerReference: 'pi_done', amountMinor: 5_000n, refundedMinor: 5_000n, remainingMinor: 0n }),
      source({ providerReference: 'pi_open', amountMinor: 7_500n, refundedMinor: 2_500n, remainingMinor: 5_000n }),
    ],
  });
  assert.deepEqual(result, {
    allocated: true,
    providerCode: 'stripe',
    providerReference: 'pi_open',
    sourceKind: 'CAPTURE',
    currency: 'AUD',
    sourceRefundableMinor: 5_000n,
    bookingRefundableMinor: 5_000n,
    refundableSourceCount: 1,
  });
});

test('fails closed when refundable money spans providers', () => {
  const result = deriveNextBookingRefundSource({
    sources: [source(), source({ kind: 'OFFLINE_PAYMENT', providerCode: 'manual', providerReference: 'receipt-1' })],
  });
  assert.equal(result.allocated, false);
  if (result.allocated) return;
  assert.match(result.reason, /multiple payment providers/i);
});

test('fails closed for inconsistent source balances and duplicate references', () => {
  const invalidBalance = deriveNextBookingRefundSource({
    sources: [source({ refundedMinor: 1_000n, remainingMinor: 10_000n })],
  });
  assert.equal(invalidBalance.allocated, false);

  const duplicate = deriveNextBookingRefundSource({ sources: [source(), source()] });
  assert.equal(duplicate.allocated, false);
  if (duplicate.allocated) return;
  assert.match(duplicate.reason, /duplicate provider references/i);
});

test('keeps large exact-money totals in bigint arithmetic', () => {
  const large = 9_007_199_254_740_993n;
  const result = deriveNextBookingRefundSource({
    sources: [
      source({ providerReference: 'pi_a', amountMinor: large, remainingMinor: large }),
      source({ providerReference: 'pi_b', amountMinor: large - 1n, remainingMinor: large - 1n }),
    ],
  });
  assert.equal(result.allocated && result.bookingRefundableMinor, (large * 2n) - 1n);
});
