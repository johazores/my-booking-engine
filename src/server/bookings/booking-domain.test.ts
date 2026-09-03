import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertBookingPriceSnapshotMatchesConfirmation,
  assertBookingStateTransition,
  bookingConfirmationPayloadMatches,
  canTransitionBookingState,
  createHospitalityPriceSnapshot,
  createHospitalityPricingBreakdownSnapshot,
  normalizeBookingIdempotencyKey,
  normalizeBookingPricingFingerprint,
  normalizeHospitalityBookingConfirmationInput,
  normalizeHospitalityBookingGuests,
} from './booking-domain.ts';

const fingerprint = 'a'.repeat(64);
const holdId = '11111111-1111-4111-8111-111111111111';
const customerId = '22222222-2222-4222-8222-222222222222';
const addonA = '33333333-3333-4333-8333-333333333333';
const addonB = '44444444-4444-4444-8444-444444444444';
const taxRuleId = '55555555-5555-4555-8555-555555555555';
const feeRuleId = '66666666-6666-4666-8666-666666666666';
const guests = [{ firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' }];

function pricingBreakdown(overrides: Partial<Parameters<typeof createHospitalityPricingBreakdownSnapshot>[0]> = {}) {
  return {
    currency: 'USD',
    quantity: 2,
    accommodationSubtotalMinor: '40000',
    taxTotalMinor: '4000',
    feeTotalMinor: '1000',
    addonTotalMinor: '1200',
    totalMinor: '46200',
    pricingFingerprint: fingerprint,
    nightly: [
      { date: '2026-10-01', amountMinor: '10000' },
      { date: '2026-10-02', amountMinor: '10000' },
    ],
    charges: [
      { id: taxRuleId, code: 'city_tax', name: 'City tax', kind: 'TAX', calculation: 'PERCENTAGE', amountMinor: '4000' },
      { id: feeRuleId, code: 'service_fee', name: 'Service fee', kind: 'FEE', calculation: 'FIXED_PER_BOOKING', amountMinor: '1000' },
    ],
    addons: [
      { id: addonA, code: 'breakfast', name: 'Breakfast', pricingModel: 'PER_BOOKING', selectedQuantity: 1, amountMinor: '1200' },
    ],
    ...overrides,
  };
}

test('normalizes booking confirmation boundaries, UUIDs, add-ons, guests, and idempotency inputs', () => {
  assert.deepEqual(normalizeHospitalityBookingConfirmationInput({
    holdId: ` ${holdId.toUpperCase()} `,
    customerId: ` ${customerId.toUpperCase()} `,
    idempotencyKey: 'booking:12345',
    expectedPricingFingerprint: fingerprint.toUpperCase(),
    addonSelections: [{ addonId: addonB, quantity: 1 }, { addonId: addonA, quantity: 2 }],
    guests: [{ firstName: ' Ada ', lastName: ' Lovelace ', email: ' ADA@EXAMPLE.COM ' }],
  }), {
    holdId,
    customerId,
    idempotencyKey: 'booking:12345',
    expectedPricingFingerprint: fingerprint,
    addonSelections: [{ addonId: addonA, quantity: 2 }, { addonId: addonB, quantity: 1 }],
    guests,
  });
  assert.throws(() => normalizeHospitalityBookingConfirmationInput({ holdId: 'hold-id', customerId, idempotencyKey: 'booking:12345', expectedPricingFingerprint: fingerprint, guests }), /UUID/);
  assert.throws(() => normalizeHospitalityBookingConfirmationInput({ holdId, customerId: 'customer-id', idempotencyKey: 'booking:12345', expectedPricingFingerprint: fingerprint, guests }), /UUID/);
  assert.throws(() => normalizeBookingIdempotencyKey('short'), /8-120/);
  assert.throws(() => normalizeBookingIdempotencyKey('booking key with spaces'), /8-120/);
  assert.throws(() => normalizeBookingPricingFingerprint('not-a-fingerprint'), /SHA-256/);
});

test('normalizes booking guest snapshots and rejects malformed or excessive guest data', () => {
  assert.deepEqual(normalizeHospitalityBookingGuests([{ firstName: ' Grace ', lastName: ' Hopper ', email: '' }]), [{ firstName: 'Grace', lastName: 'Hopper', email: null }]);
  assert.throws(() => normalizeHospitalityBookingGuests([]), /At least one/);
  assert.throws(() => normalizeHospitalityBookingGuests([{ firstName: '', lastName: 'Hopper' }]), /first name is required/);
  assert.throws(() => normalizeHospitalityBookingGuests([{ firstName: 'Grace', lastName: 'Hopper', email: 'invalid' }]), /valid email/);
  assert.throws(() => normalizeHospitalityBookingGuests(Array.from({ length: 101 }, () => ({ firstName: 'Guest', lastName: 'Name' }))), /cannot exceed 100/);
});

test('creates exact immutable price snapshots and rejects inconsistent totals', () => {
  const snapshot = createHospitalityPriceSnapshot({ currency: 'usd', accommodationSubtotalMinor: '20000', taxTotalMinor: '2400', feeTotalMinor: '500', addonTotalMinor: '1200', totalMinor: '24100', pricingFingerprint: fingerprint });
  assert.deepEqual(snapshot, { currency: 'USD', accommodationSubtotalMinor: '20000', taxTotalMinor: '2400', feeTotalMinor: '500', addonTotalMinor: '1200', totalMinor: '24100', pricingFingerprint: fingerprint });
  assert.equal(Object.isFrozen(snapshot), true);
  assert.throws(() => createHospitalityPriceSnapshot({ currency: 'USD', accommodationSubtotalMinor: '20000', taxTotalMinor: '2400', feeTotalMinor: '500', addonTotalMinor: '1200', totalMinor: '24099', pricingFingerprint: fingerprint }), /must equal/);
  assert.throws(() => createHospitalityPriceSnapshot({ currency: 'USD', accommodationSubtotalMinor: '20.00', taxTotalMinor: '0', feeTotalMinor: '0', addonTotalMinor: '0', totalMinor: '2000', pricingFingerprint: fingerprint }), /integer minor-unit/);
});

test('creates a canonical immutable pricing breakdown that reconciles every persisted aggregate', () => {
  const snapshot = createHospitalityPricingBreakdownSnapshot(pricingBreakdown());
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.currency, 'USD');
  assert.equal(snapshot.quantity, 2);
  assert.deepEqual(snapshot.nightly, [
    { date: '2026-10-01', amountMinor: '10000' },
    { date: '2026-10-02', amountMinor: '10000' },
  ]);
  assert.deepEqual(snapshot.charges, [
    { ruleId: taxRuleId, code: 'CITY_TAX', name: 'City tax', kind: 'TAX', calculation: 'PERCENTAGE', amountMinor: '4000' },
    { ruleId: feeRuleId, code: 'SERVICE_FEE', name: 'Service fee', kind: 'FEE', calculation: 'FIXED_PER_BOOKING', amountMinor: '1000' },
  ]);
  assert.deepEqual(snapshot.addons, [
    { addonId: addonA, code: 'BREAKFAST', name: 'Breakfast', pricingModel: 'PER_BOOKING', selectedQuantity: 1, amountMinor: '1200' },
  ]);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.nightly), true);
  assert.equal(Object.isFrozen(snapshot.nightly[0]), true);
  assert.equal(Object.isFrozen(snapshot.charges[0]), true);
  assert.equal(Object.isFrozen(snapshot.addons[0]), true);
});

test('pricing breakdown rejects aggregate drift, duplicated identities, and malformed line evidence', () => {
  assert.throws(
    () => createHospitalityPricingBreakdownSnapshot(pricingBreakdown({ accommodationSubtotalMinor: '39999', totalMinor: '46199' })),
    /nightly prices do not equal/,
  );
  assert.throws(
    () => createHospitalityPricingBreakdownSnapshot(pricingBreakdown({ taxTotalMinor: '3999', totalMinor: '46199' })),
    /charge lines do not equal/,
  );
  assert.throws(
    () => createHospitalityPricingBreakdownSnapshot(pricingBreakdown({ addonTotalMinor: '1199', totalMinor: '46199' })),
    /add-on lines do not equal/,
  );
  assert.throws(
    () => createHospitalityPricingBreakdownSnapshot(pricingBreakdown({ nightly: [
      { date: '2026-10-02', amountMinor: '10000' },
      { date: '2026-10-01', amountMinor: '10000' },
    ] })),
    /strictly increasing/,
  );
  assert.throws(
    () => createHospitalityPricingBreakdownSnapshot(pricingBreakdown({ charges: [
      { id: taxRuleId, code: 'CITY_TAX', name: 'City tax', kind: 'TAX', calculation: 'PERCENTAGE', amountMinor: '2000' },
      { id: taxRuleId, code: 'CITY_TAX_2', name: 'Duplicate city tax', kind: 'TAX', calculation: 'PERCENTAGE', amountMinor: '2000' },
      { id: feeRuleId, code: 'SERVICE_FEE', name: 'Service fee', kind: 'FEE', calculation: 'FIXED_PER_BOOKING', amountMinor: '1000' },
    ] })),
    /same charge rule/,
  );
  assert.throws(
    () => createHospitalityPricingBreakdownSnapshot(pricingBreakdown({ addons: [
      { id: addonA, code: 'BREAKFAST', name: 'Breakfast', pricingModel: 'UNKNOWN', selectedQuantity: 1, amountMinor: '1200' },
    ] })),
    /pricing model is not supported/,
  );
});

test('requires the immutable snapshot to match the confirmation fingerprint', () => {
  const confirmation = { holdId, customerId, idempotencyKey: 'booking:12345', expectedPricingFingerprint: fingerprint, guests };
  const snapshot = createHospitalityPriceSnapshot({ currency: 'USD', accommodationSubtotalMinor: '20000', taxTotalMinor: '2400', feeTotalMinor: '500', addonTotalMinor: '1200', totalMinor: '24100', pricingFingerprint: fingerprint });
  assert.doesNotThrow(() => assertBookingPriceSnapshotMatchesConfirmation(confirmation, snapshot));
  assert.throws(() => assertBookingPriceSnapshotMatchesConfirmation({ ...confirmation, expectedPricingFingerprint: 'b'.repeat(64) }, snapshot), /does not match/);
});

test('keeps booking lifecycle explicit and separate from payment state', () => {
  assert.equal(canTransitionBookingState('PENDING_CONFIRMATION', 'CONFIRMED'), true);
  assert.equal(canTransitionBookingState('PENDING_CONFIRMATION', 'CANCELLED'), true);
  assert.equal(canTransitionBookingState('CONFIRMED', 'CANCELLED'), true);
  assert.equal(canTransitionBookingState('CONFIRMED', 'PENDING_CONFIRMATION'), false);
  assert.equal(canTransitionBookingState('CANCELLED', 'CONFIRMED'), false);
  assert.throws(() => assertBookingStateTransition('CANCELLED', 'CONFIRMED'), /cannot transition/);
});

test('detects idempotent booking retries and mismatched payload reuse including add-ons and guests', () => {
  const original = { holdId, customerId, idempotencyKey: 'booking:12345', expectedPricingFingerprint: fingerprint, addonSelections: [{ addonId: addonA, quantity: 2 }], guests };
  assert.equal(bookingConfirmationPayloadMatches(original, { ...original }), true);
  assert.equal(bookingConfirmationPayloadMatches(original, { ...original, holdId: '55555555-5555-4555-8555-555555555555' }), false);
  assert.equal(bookingConfirmationPayloadMatches(original, { ...original, customerId: '66666666-6666-4666-8666-666666666666' }), false);
  assert.equal(bookingConfirmationPayloadMatches(original, { ...original, expectedPricingFingerprint: 'b'.repeat(64) }), false);
  assert.equal(bookingConfirmationPayloadMatches(original, { ...original, addonSelections: [{ addonId: addonA, quantity: 1 }] }), false);
  assert.equal(bookingConfirmationPayloadMatches(original, { ...original, guests: [{ firstName: 'Alan', lastName: 'Turing' }] }), false);
});
