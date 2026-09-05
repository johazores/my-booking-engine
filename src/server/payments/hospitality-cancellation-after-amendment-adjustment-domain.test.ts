import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveHospitalityCancellationAfterAmendmentAdjustmentReadiness,
  HOSPITALITY_CANCELLATION_AFTER_AMENDMENT_REFUND_LIMIT,
  type HospitalityCancellationAfterAmendmentPaymentTransaction,
} from './hospitality-cancellation-after-amendment-adjustment-domain.ts';

const headIssuedAt = new Date('2026-09-05T01:00:00.000Z');
const chainHead = Object.freeze({
  adjustmentNoteId: '11111111-1111-4111-8111-111111111111',
  sourceAdjustmentOrdinal: 2,
  documentNumber: 'AU-ADJ-00000002',
  issuedAt: headIssuedAt,
  documentFingerprint: 'a'.repeat(64),
  afterPricingFingerprint: 'b'.repeat(64),
  currency: 'AUD',
  accommodationSubtotalMinor: 10_000n,
  taxTotalMinor: 1_000n,
  feeTotalMinor: 0n,
  addonTotalMinor: 0n,
  totalMinor: 11_000n,
});

function transaction(input: Partial<HospitalityCancellationAfterAmendmentPaymentTransaction> & Pick<HospitalityCancellationAfterAmendmentPaymentTransaction, 'id' | 'kind' | 'providerReference' | 'amountMinor' | 'createdAt'>): HospitalityCancellationAfterAmendmentPaymentTransaction {
  return {
    status: 'SUCCEEDED',
    providerCode: 'stripe',
    sourceProviderReference: null,
    currency: 'AUD',
    commercialAmendmentId: null,
    ...input,
  };
}

const settledBeforeHead = [
  transaction({ id: '20000000-0000-4000-8000-000000000001', kind: 'CAPTURE', providerReference: 'pi_base', amountMinor: 8_800n, createdAt: new Date('2026-09-04T22:00:00.000Z') }),
  transaction({ id: '20000000-0000-4000-8000-000000000002', kind: 'CAPTURE', providerReference: 'pi_amendment', amountMinor: 2_200n, commercialAmendmentId: '30000000-0000-4000-8000-000000000001', createdAt: new Date('2026-09-05T00:30:00.000Z') }),
];

function input(transactions: readonly HospitalityCancellationAfterAmendmentPaymentTransaction[]) {
  return {
    bookingStatus: 'CANCELLED',
    bookingPaymentStatus: 'REFUNDED',
    bookingCurrency: 'AUD',
    bookingTotalMinor: 11_000n,
    chainHead,
    transactions,
  };
}

test('accepts multiple source-attributed refunds that exactly unwind the verified current legal price', () => {
  const result = deriveHospitalityCancellationAfterAmendmentAdjustmentReadiness(input([
    ...settledBeforeHead,
    transaction({ id: '40000000-0000-4000-8000-000000000001', kind: 'REFUND', providerReference: 're_1', sourceProviderReference: 'pi_base', amountMinor: 8_800n, createdAt: new Date('2026-09-05T02:00:00.000Z') }),
    transaction({ id: '40000000-0000-4000-8000-000000000002', kind: 'REFUND', providerReference: 're_2', sourceProviderReference: 'pi_amendment', amountMinor: 2_200n, createdAt: new Date('2026-09-05T02:01:00.000Z') }),
  ]));
  assert.equal(result.ready, true);
  if (!result.ready) return;
  assert.equal(result.sourceAdjustmentOrdinal, 3);
  assert.equal(result.predecessorAdjustmentNoteId, chainHead.adjustmentNoteId);
  assert.equal(result.decreaseSubtotalMinor, 10_000n);
  assert.equal(result.decreaseTaxMinor, 1_000n);
  assert.equal(result.decreaseTotalMinor, 11_000n);
  assert.deepEqual(result.refundAuthorities.map((item) => item.refundTransactionId), [
    '40000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000002',
  ]);
});

test('fails closed when settlement at the legal chain head is not exactly the head price', () => {
  const result = deriveHospitalityCancellationAfterAmendmentAdjustmentReadiness(input([
    settledBeforeHead[0]!,
    transaction({ id: '40000000-0000-4000-8000-000000000001', kind: 'REFUND', providerReference: 're_1', sourceProviderReference: 'pi_base', amountMinor: 8_800n, createdAt: new Date('2026-09-05T02:00:00.000Z') }),
  ]));
  assert.equal(result.ready, false);
  if (!result.ready) assert.match(result.reason, /chain head/i);
});

test('fails closed on payment activity after the head that is not a terminal non-commercial refund', () => {
  const result = deriveHospitalityCancellationAfterAmendmentAdjustmentReadiness(input([
    ...settledBeforeHead,
    transaction({ id: '50000000-0000-4000-8000-000000000001', kind: 'CAPTURE', providerReference: 'pi_late', amountMinor: 1_000n, createdAt: new Date('2026-09-05T01:30:00.000Z') }),
  ]));
  assert.equal(result.ready, false);
  if (!result.ready) assert.match(result.reason, /only resolved/i);
});

test('fails closed when current settlement is not fully refunded to zero', () => {
  const result = deriveHospitalityCancellationAfterAmendmentAdjustmentReadiness(input([
    ...settledBeforeHead,
    transaction({ id: '40000000-0000-4000-8000-000000000001', kind: 'REFUND', providerReference: 're_1', sourceProviderReference: 'pi_base', amountMinor: 8_800n, createdAt: new Date('2026-09-05T02:00:00.000Z') }),
  ]));
  assert.equal(result.ready, false);
  if (!result.ready) assert.match(result.reason, /exactly to zero/i);
});

test('fails closed on an unresolved post-head refund', () => {
  const result = deriveHospitalityCancellationAfterAmendmentAdjustmentReadiness(input([
    ...settledBeforeHead,
    transaction({ id: '40000000-0000-4000-8000-000000000001', kind: 'REFUND', status: 'PENDING', providerReference: 're_pending', sourceProviderReference: 'pi_base', amountMinor: 8_800n, createdAt: new Date('2026-09-05T02:00:00.000Z') }),
  ]));
  assert.equal(result.ready, false);
  if (!result.ready) assert.match(result.reason, /only resolved/i);
});

test('fails closed when the booking mutable total has drifted from the legal head', () => {
  const result = deriveHospitalityCancellationAfterAmendmentAdjustmentReadiness({
    ...input(settledBeforeHead),
    bookingTotalMinor: 9_900n,
  });
  assert.equal(result.ready, false);
  if (!result.ready) assert.match(result.reason, /chain-head price/i);
});

test('bounds frozen cancellation refund authority', () => {
  const refunds = Array.from({ length: HOSPITALITY_CANCELLATION_AFTER_AMENDMENT_REFUND_LIMIT + 1 }, (_, index) => transaction({
    id: `40000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    kind: 'REFUND',
    providerReference: `re_${index}`,
    sourceProviderReference: index === 0 ? 'pi_base' : 'pi_amendment',
    amountMinor: index === 0 ? 8_800n : index === 1 ? 2_200n : 1n,
    createdAt: new Date(headIssuedAt.getTime() + 60_000 + index),
  }));
  const result = deriveHospitalityCancellationAfterAmendmentAdjustmentReadiness(input([...settledBeforeHead, ...refunds]));
  assert.equal(result.ready, false);
});
