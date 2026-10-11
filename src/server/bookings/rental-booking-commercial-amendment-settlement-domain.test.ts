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

test('commercial amendment refund source rejects malformed money and retained histories without coercion', () => {
  const base = {
    currency: 'AUD',
    deltaMinor: 2_500n,
    bookingSources: [source('payment-a', 5_000n)],
    priorAmendmentRefunds: [],
  };
  const unsafe = { valueOf() { throw new Error('unexpected coercion'); }, toString() { throw new Error('unexpected coercion'); } };
  for (const currency of [null, undefined, 123, unsafe]) {
    const result = deriveRentalBookingCommercialAmendmentRefundSource({
      ...base,
      currency: currency as unknown as string,
    });
    assert.equal(result.available, false);
  }
  for (const deltaMinor of [null, undefined, '2500', 2500, unsafe]) {
    const result = deriveRentalBookingCommercialAmendmentRefundSource({
      ...base,
      deltaMinor: deltaMinor as unknown as bigint,
    });
    assert.equal(result.available, false);
  }
  for (const bookingSources of [
    null, {}, [null], [undefined],
    [{ ...source('payment-a', 5_000n), amountMinor: '5000' }],
    [{ ...source('payment-a', 5_000n), refundedMinor: unsafe }],
    [{ ...source('payment-a', 5_000n), remainingMinor: -1n }],
    [{ ...source('payment-a', 5_000n), remainingMinor: 6_000n }],
    [{ ...source('payment-a', 5_000n), providerReference: ' padded ' }],
    [{ ...source('payment-a', 5_000n), providerReference: 'sf_claim_pending' }],
    [source('payment-a', 5_000n), source('payment-a', 5_000n)],
  ]) {
    const result = deriveRentalBookingCommercialAmendmentRefundSource({
      ...base,
      bookingSources: bookingSources as unknown as typeof base.bookingSources,
    });
    assert.equal(result.available, false);
  }
  for (const priorAmendmentRefunds of [
    null, {}, [null], [undefined],
    [{ providerCode: 'manual', currency: 'AUD', sourceProviderReference: 'payment-a', amountMinor: '1000' }],
    [{ providerCode: 'manual', currency: 'AUD', sourceProviderReference: unsafe, amountMinor: 1_000n }],
    [{ providerCode: 'manual', currency: 'AUD', sourceProviderReference: ' payment-a ', amountMinor: 1_000n }],
    [{ providerCode: 'manual', currency: 'AUD', sourceProviderReference: 'sf_claim_source', amountMinor: 1_000n }],
  ]) {
    const result = deriveRentalBookingCommercialAmendmentRefundSource({
      ...base,
      priorAmendmentRefunds: priorAmendmentRefunds as unknown as typeof base.priorAmendmentRefunds,
    });
    assert.equal(result.available, false);
  }
  const valid = deriveRentalBookingCommercialAmendmentRefundSource({
    ...base,
    priorAmendmentRefunds: [{
      providerCode: 'manual', currency: 'AUD', sourceProviderReference: 'payment-a', amountMinor: 1_000n,
    }],
  });
  assert.equal(valid.available, true);
  if (valid.available) assert.equal(valid.refundableMinor, 4_000n);
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

test('commercial amendment settlement rejects malformed collections, identities, and money without throwing', () => {
  const base = { direction: 'ADDITIONAL_CHARGE' as const, currency: 'AUD', deltaMinor: 2500n };
  for (const rows of [null, {}, [null], [{ ...payment, purpose: 'UNKNOWN' }]]) {
    const result = deriveRentalBookingCommercialAmendmentSettlementState({
      ...base,
      rows: rows as unknown as RentalBookingCommercialAmendmentSettlementRow[],
    });
    assert.equal(result.state, 'CONFLICT');
  }
  for (const providerReference of [null, 123, ' padded ', 'sf_claim_reserved', 'line\nbreak']) {
    const result = deriveRentalBookingCommercialAmendmentSettlementState({
      ...base,
      rows: [{ ...payment, providerReference: providerReference as string }],
    });
    assert.equal(result.state, 'CONFLICT');
  }
  for (const currency of [null, undefined, 123, { toString() { throw new Error('unexpected coercion'); } }]) {
    const result = deriveRentalBookingCommercialAmendmentSettlementState({
      ...base,
      currency: currency as unknown as string,
      rows: [payment],
    });
    assert.equal(result.state, 'CONFLICT');
  }
  for (const deltaMinor of [null, undefined, 2500, '2500']) {
    const result = deriveRentalBookingCommercialAmendmentSettlementState({
      ...base,
      deltaMinor: deltaMinor as unknown as bigint,
      rows: [payment],
    });
    assert.equal(result.state, 'CONFLICT');
  }
  const invalidDirection = deriveRentalBookingCommercialAmendmentSettlementState({
    ...base,
    direction: 'UNKNOWN' as 'ADDITIONAL_CHARGE',
    rows: [],
  });
  assert.equal(invalidDirection.state, 'CONFLICT');
  for (const sourceProviderReference of [' padded ', 'line\nbreak', 'sf_claim_pending']) {
    const result = deriveRentalBookingCommercialAmendmentSettlementState({
      direction: 'REFUND',
      currency: 'AUD',
      deltaMinor: 2500n,
      rows: [{ ...refund, sourceProviderReference }],
    });
    assert.equal(result.state, 'CONFLICT');
  }
  const invalidSource = deriveRentalBookingCommercialAmendmentSettlementState({
    direction: 'REFUND',
    currency: 'AUD',
    deltaMinor: 2500n,
    rows: [{ ...refund, sourceProviderReference: 123 as unknown as string }],
  });
  assert.equal(invalidSource.state, 'CONFLICT');
});
