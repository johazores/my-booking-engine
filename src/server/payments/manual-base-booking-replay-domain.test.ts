import assert from 'node:assert/strict';
import test from 'node:test';

import { matchesManualBaseBookingReplay } from './manual-base-booking-replay-domain.ts';

const payment = {
  bookingId: 'booking-a',
  commercialAmendmentId: null,
  kind: 'OFFLINE_PAYMENT',
  status: 'SUCCEEDED',
  providerCode: 'manual',
  providerReference: 'BANK-123',
  amountMinor: 1000n,
};

test('normal manual payment replays require exact base booking ownership and completed evidence', () => {
  const input = { existing: payment, bookingId: 'booking-a', kind: 'OFFLINE_PAYMENT' as const, providerCode: 'manual', reference: 'BANK-123' };
  assert.equal(matchesManualBaseBookingReplay(input), true);
  assert.equal(matchesManualBaseBookingReplay({ ...input, existing: { ...payment, commercialAmendmentId: 'amendment-a' } }), false);
  assert.equal(matchesManualBaseBookingReplay({ ...input, existing: { ...payment, status: 'FAILED' } }), false);
  assert.equal(matchesManualBaseBookingReplay({ ...input, existing: { ...payment, status: 'PENDING' } }), false);
  assert.equal(matchesManualBaseBookingReplay({ ...input, existing: { ...payment, bookingId: 'booking-b' } }), false);
  assert.equal(matchesManualBaseBookingReplay({ ...input, existing: { ...payment, kind: 'REFUND' } }), false);
  assert.equal(matchesManualBaseBookingReplay({ ...input, existing: { ...payment, providerCode: 'stripe' } }), false);
  assert.equal(matchesManualBaseBookingReplay({ ...input, existing: { ...payment, providerReference: 'BANK-OTHER' } }), false);
});

test('normal manual refund replays cannot claim amendment refunds or change explicit money', () => {
  const refund = { ...payment, kind: 'REFUND', providerReference: 'BANK-REFUND-123', amountMinor: 400n };
  const input = { existing: refund, bookingId: 'booking-a', kind: 'REFUND' as const, providerCode: 'manual', reference: 'BANK-REFUND-123', requestedAmountMinor: 400n };
  assert.equal(matchesManualBaseBookingReplay(input), true);
  assert.equal(matchesManualBaseBookingReplay({ ...input, requestedAmountMinor: null }), true);
  assert.equal(matchesManualBaseBookingReplay({ ...input, requestedAmountMinor: 401n }), false);
  assert.equal(matchesManualBaseBookingReplay({ ...input, existing: { ...refund, commercialAmendmentId: 'amendment-a' } }), false);
  assert.equal(matchesManualBaseBookingReplay({ ...input, existing: { ...refund, status: 'AMBIGUOUS' } }), false);
});
