import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HospitalityBookingPricingEvidenceValidationError,
  assertHospitalityBookingPricingEvidenceMatchesCommercialState,
  assertHospitalityBookingPricingQuoteMatchesCommercialState,
  createHospitalityBookingPricingEvidenceBreakdown,
  parseHospitalityBookingPricingEvidenceBreakdown,
  type HospitalityBookingPricingEvidenceQuote,
} from './booking-pricing-evidence-domain.ts';

const propertyId = '11111111-1111-4111-8111-111111111111';
const roomTypeId = '22222222-2222-4222-8222-222222222222';
const ratePlanId = '33333333-3333-4333-8333-333333333333';
const taxRuleId = '44444444-4444-4444-8444-444444444444';
const feeRuleId = '55555555-5555-4555-8555-555555555555';
const addonId = '66666666-6666-4666-8666-666666666666';
const fingerprint = 'a'.repeat(64);

function quote(overrides: Partial<HospitalityBookingPricingEvidenceQuote> = {}): HospitalityBookingPricingEvidenceQuote {
  return {
    propertyId,
    roomTypeId,
    ratePlanId,
    arrivalDate: '2026-10-01',
    departureDate: '2026-10-03',
    quantity: 2,
    currency: 'USD',
    nightly: [
      { date: '2026-10-01', amountMinor: '10000' },
      { date: '2026-10-02', amountMinor: '10000' },
    ],
    charges: [
      { id: taxRuleId, code: 'city_tax', name: 'City tax', kind: 'TAX', calculation: 'PERCENTAGE', amountMinor: '4000' },
      { id: feeRuleId, code: 'service_fee', name: 'Service fee', kind: 'FEE', calculation: 'FIXED_PER_BOOKING', amountMinor: '1000' },
    ],
    addons: [
      { id: addonId, code: 'breakfast', name: 'Breakfast', pricingModel: 'PER_BOOKING', selectedQuantity: 1, amountMinor: '1200' },
    ],
    accommodationSubtotalMinor: '40000',
    taxTotalMinor: '4000',
    feeTotalMinor: '1000',
    addonTotalMinor: '1200',
    totalMinor: '46200',
    fingerprint,
    ...overrides,
  };
}

const state = {
  propertyId,
  roomTypeId,
  ratePlanId,
  arrivalDate: new Date('2026-10-01T00:00:00.000Z'),
  departureDate: new Date('2026-10-03T00:00:00.000Z'),
  quantity: 2,
  addonSelections: [{ addonId, quantity: 1 }],
};

test('converts an authoritative transactional quote into canonical immutable pricing evidence', () => {
  const breakdown = assertHospitalityBookingPricingQuoteMatchesCommercialState({ quote: quote(), state });
  assert.equal(breakdown.schemaVersion, 1);
  assert.equal(breakdown.pricingFingerprint, fingerprint);
  assert.equal(breakdown.charges[0]?.ruleId, taxRuleId);
  assert.equal(breakdown.addons[0]?.addonId, addonId);
  assert.equal(Object.isFrozen(breakdown), true);
});

test('round-trips persisted pricing evidence through the strict parser', () => {
  const breakdown = createHospitalityBookingPricingEvidenceBreakdown(quote());
  const parsed = parseHospitalityBookingPricingEvidenceBreakdown(JSON.parse(JSON.stringify(breakdown)));
  assert.deepEqual(parsed, breakdown);
  assert.doesNotThrow(() => assertHospitalityBookingPricingEvidenceMatchesCommercialState({ breakdown: parsed, state }));
});

test('rejects quote/commercial-state drift before persistence', () => {
  assert.throws(
    () => assertHospitalityBookingPricingQuoteMatchesCommercialState({ quote: quote({ roomTypeId: crypto.randomUUID() }), state }),
    HospitalityBookingPricingEvidenceValidationError,
  );
  assert.throws(
    () => assertHospitalityBookingPricingQuoteMatchesCommercialState({ quote: quote({ departureDate: '2026-10-04' }), state }),
    HospitalityBookingPricingEvidenceValidationError,
  );
});

test('rejects persisted evidence with malformed schema, stay dates, add-ons, or aggregates', () => {
  const breakdown = JSON.parse(JSON.stringify(createHospitalityBookingPricingEvidenceBreakdown(quote())));
  assert.throws(() => parseHospitalityBookingPricingEvidenceBreakdown({ ...breakdown, schemaVersion: 2 }), /schema version/);
  assert.throws(
    () => assertHospitalityBookingPricingEvidenceMatchesCommercialState({
      breakdown: parseHospitalityBookingPricingEvidenceBreakdown(breakdown),
      state: { ...state, departureDate: new Date('2026-10-04T00:00:00.000Z') },
    }),
    /nightly dates/,
  );
  assert.throws(
    () => assertHospitalityBookingPricingEvidenceMatchesCommercialState({
      breakdown: parseHospitalityBookingPricingEvidenceBreakdown(breakdown),
      state: { ...state, addonSelections: [] },
    }),
    /add-on selections/,
  );
  assert.throws(
    () => parseHospitalityBookingPricingEvidenceBreakdown({ ...breakdown, totalMinor: '46199' }),
    /must equal/,
  );
});
