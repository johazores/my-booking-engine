import assert from 'node:assert/strict';
import test from 'node:test';

import { serializePublicHospitalityQuote } from './public-hospitality-quote-domain.ts';

test('serializes only customer-safe final quote fields, including nested objects', () => {
  const quote = serializePublicHospitalityQuote({
    arrivalDate: '2026-10-10',
    departureDate: '2026-10-12',
    stayNights: 2,
    quantity: 1,
    currency: 'PHP',
    nightly: [{ date: '2026-10-10', amountMinor: '500000' }],
    charges: [{ id: 'internal-charge-id', code: 'VAT', kind: 'TAX', calculation: 'PERCENTAGE', amountMinor: '60000' }],
    addons: [{ id: 'internal-addon-id', code: 'BREAKFAST', pricingModel: 'PER_STAY', selectedQuantity: 1, amountMinor: '50000' }],
    accommodationSubtotalMinor: '500000',
    taxTotalMinor: '60000',
    feeTotalMinor: '0',
    addonTotalMinor: '50000',
    totalMinor: '610000',
    fingerprint: 'a'.repeat(64),
  }, new Date('2026-10-10T12:00:00.000Z'));

  assert.equal(quote.pricingFingerprint, 'a'.repeat(64));
  assert.equal(quote.totalMinor, '610000');
  assert.equal(quote.holdExpiresAt, '2026-10-10T12:00:00.000Z');
  assert.equal('propertyId' in quote, false);
  assert.equal('roomTypeId' in quote, false);
  assert.equal('ratePlanId' in quote, false);
  assert.equal('organizationId' in quote, false);
  assert.equal('holdId' in quote, false);
  assert.equal('principalId' in quote, false);
  assert.deepEqual(quote.charges[0], { code: 'VAT', kind: 'TAX', calculation: 'PERCENTAGE', amountMinor: '60000' });
  assert.deepEqual(quote.addons[0], { code: 'BREAKFAST', pricingModel: 'PER_STAY', selectedQuantity: 1, amountMinor: '50000' });
  assert.equal('id' in quote.charges[0], false);
  assert.equal('id' in quote.addons[0], false);
});

test('rejects an invalid hold expiry', () => {
  assert.throws(() => serializePublicHospitalityQuote({
    arrivalDate: '2026-10-10', departureDate: '2026-10-12', stayNights: 2, quantity: 1, currency: 'PHP',
    nightly: [], charges: [], addons: [], accommodationSubtotalMinor: '0', taxTotalMinor: '0', feeTotalMinor: '0',
    addonTotalMinor: '0', totalMinor: '0', fingerprint: 'a'.repeat(64),
  }, new Date(Number.NaN)), /valid date/);
});
