import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRentalBookingCommercialAmendmentSettlementIdempotencyKey,
  buildRentalBookingCommercialAmendmentSettlementRequestFingerprint,
  deriveRentalBookingCommercialAmendmentRefundSource,
  deriveRentalBookingCommercialAmendmentSettlementState,
  type RentalBookingCommercialAmendmentSettlementRow,
} from './rental-booking-commercial-amendment-settlement-domain.ts';

const payment: RentalBookingCommercialAmendmentSettlementRow = {
  purpose: 'ADJUSTMENT', kind: 'OFFLINE_PAYMENT', status: 'SUCCEEDED', providerCode: 'manual',
  providerReference: 'adjustment-1', sourceProviderReference: null, currency: 'AUD', amountMinor: 2500n,
};
const refund: RentalBookingCommercialAmendmentSettlementRow = {
  purpose: 'ADJUSTMENT', kind: 'REFUND', status: 'SUCCEEDED', providerCode: 'manual',
  providerReference: 'adjustment-refund-1', sourceProviderReference: 'booking-payment-1', currency: 'AUD', amountMinor: 2500n,
};

const source = (providerReference: string, amountMinor: bigint, remainingMinor = amountMinor) => ({
  kind: 'OFFLINE_PAYMENT' as const,
  providerCode: 'manual',
  providerReference,
  currency: 'AUD',
  amountMinor,
  refundedMinor: amountMinor - remainingMinor,
  remainingMinor,
});

test('commercial amendment settlement is exact and direction aware', () => {
  assert.deepEqual(deriveRentalBookingCommercialAmendmentSettlementState({ direction: 'ADDITIONAL_CHARGE', currency: 'AUD', deltaMinor: 2500n, rows: [] }).state, 'UNSETTLED');
  assert.deepEqual(deriveRentalBookingCommercialAmendmentSettlementState({ direction: 'ADDITIONAL_CHARGE', currency: 'AUD', deltaMinor: 2500n, rows: [payment] }).state, 'SETTLED');
  assert.deepEqual(deriveRentalBookingCommercialAmendmentSettlementState({ direction: 'REFUND', currency: 'AUD', deltaMinor: 2500n, rows: [refund] }).state, 'SETTLED');
});

test('commercial amendment settlement rejects wrong money and wrong direction', () => {
  assert.equal(deriveRentalBookingCommercialAmendmentSettlementState({ direction: 'REFUND', currency: 'AUD', deltaMinor: 2500n, rows: [payment] }).state, 'CONFLICT');
  assert.equal(deriveRentalBookingCommercialAmendmentSettlementState({ direction: 'ADDITIONAL_CHARGE', currency: 'AUD', deltaMinor: 2600n, rows: [payment] }).state, 'CONFLICT');
});

test('commercial amendment compensation exactly reverses adjustment evidence', () => {
  const compensation: RentalBookingCommercialAmendmentSettlementRow = {
    purpose: 'COMPENSATION', kind: 'REFUND', status: 'SUCCEEDED', providerCode: 'manual',
    providerReference: 'compensation-1', sourceProviderReference: payment.providerReference, currency: 'AUD', amountMinor: 2500n,
  };
  assert.equal(deriveRentalBookingCommercialAmendmentSettlementState({ direction: 'ADDITIONAL_CHARGE', currency: 'AUD', deltaMinor: 2500n, rows: [payment, compensation] }).state, 'COMPENSATED');
  assert.equal(deriveRentalBookingCommercialAmendmentSettlementState({ direction: 'ADDITIONAL_CHARGE', currency: 'AUD', deltaMinor: 2500n, rows: [compensation] }).state, 'CONFLICT');
});

test('refund source is selected server-side from remaining source capacity', () => {
  const result = deriveRentalBookingCommercialAmendmentRefundSource({
    currency: 'AUD',
    deltaMinor: 5000n,
    bookingSources: [source('payment-a', 10000n), source('payment-b', 8000n)],
    priorAmendmentRefunds: [{
      providerCode: 'manual',
      sourceProviderReference: 'payment-a',
      currency: 'AUD',
      amountMinor: 7000n,
    }],
  });
  assert.equal(result.available, true);
  if (result.available) {
    assert.equal(result.providerReference, 'payment-b');
    assert.equal(result.refundableMinor, 8000n);
    assert.equal(result.totalRefundableMinor, 11000n);
  }
});

test('refund source fails closed when exact adjustment would need to span sources', () => {
  const result = deriveRentalBookingCommercialAmendmentRefundSource({
    currency: 'AUD',
    deltaMinor: 5000n,
    bookingSources: [source('payment-a', 3000n), source('payment-b', 4000n)],
    priorAmendmentRefunds: [],
  });
  assert.equal(result.available, false);
  if (!result.available) assert.match(result.reason, /No single retained booking-price payment source/);
});

test('refund source fails closed on irreconcilable prior amendment consumption', () => {
  const result = deriveRentalBookingCommercialAmendmentRefundSource({
    currency: 'AUD',
    deltaMinor: 1000n,
    bookingSources: [source('payment-a', 5000n, 2000n)],
    priorAmendmentRefunds: [{
      providerCode: 'manual',
      sourceProviderReference: 'payment-a',
      currency: 'AUD',
      amountMinor: 2500n,
    }],
  });
  assert.equal(result.available, false);
  if (!result.available) assert.match(result.reason, /exceed the remaining value/);
});

test('commercial amendment settlement request evidence is deterministic and sensitive', () => {
  const key = buildRentalBookingCommercialAmendmentSettlementIdempotencyKey({ amendmentId: 'a', purpose: 'ADJUSTMENT', reference: 'ref' });
  assert.equal(key, buildRentalBookingCommercialAmendmentSettlementIdempotencyKey({ amendmentId: 'a', purpose: 'ADJUSTMENT', reference: 'ref' }));
  assert.notEqual(key, buildRentalBookingCommercialAmendmentSettlementIdempotencyKey({ amendmentId: 'a', purpose: 'COMPENSATION', reference: 'ref' }));
  const base = {
    organizationId: 'o', bookingId: 'b', amendmentId: 'a', idempotencyKey: key,
    purpose: 'ADJUSTMENT' as const, kind: 'OFFLINE_PAYMENT' as const, providerCode: 'manual', providerReference: 'ref',
    sourceProviderReference: null, currency: 'AUD', amountMinor: 2500n,
  };
  assert.notEqual(
    buildRentalBookingCommercialAmendmentSettlementRequestFingerprint(base),
    buildRentalBookingCommercialAmendmentSettlementRequestFingerprint({ ...base, amountMinor: 2501n }),
  );
});
