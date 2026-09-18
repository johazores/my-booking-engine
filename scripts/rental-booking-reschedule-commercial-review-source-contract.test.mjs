import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const domain = readFileSync('src/server/bookings/rental-booking-reschedule-domain.ts', 'utf8');
const review = readFileSync('src/server/bookings/rental-booking-reschedule-authority-service.ts', 'utf8');
const page = readFileSync('app/inventory/rentals/bookings/[booking-id]/reschedule/page.tsx', 'utf8');
const authorityDocs = readFileSync('docs/rental-booking-reschedule-authority.md', 'utf8');
const lifecycleDocs = readFileSync('docs/rental-booking-reschedule-lifecycle.md', 'utf8');

test('reschedule authority derives commercial impact from accepted booking money and fresh pricing', () => {
  assert.match(domain, /buildRentalBookingRescheduleCommercialImpact/);
  assert.match(domain, /acceptedTotalMinor/);
  assert.match(domain, /targetTotalMinor/);
  assert.match(domain, /kind: 'CURRENCY_CHANGED'/);
  assert.match(domain, /signedDeltaMinor/);

  assert.match(review, /buildRentalBookingRescheduleCommercialImpact\(\{/);
  assert.match(review, /acceptedCurrency: booking\.currency/);
  assert.match(review, /acceptedTotalMinor: booking\.totalMinor/);
  assert.match(review, /targetCurrency: targetPricing\.currency/);
  assert.match(review, /targetTotalMinor: BigInt\(targetPricing\.totalMinor\)/);
  assert.match(review, /commercialImpact\.kind === 'CURRENCY_CHANGED'/);
  assert.match(review, /commercialImpact\.kind !== 'UNCHANGED'/);
  assert.match(review, /commercialImpact,/);
});

test('currency drift is separate from a same-currency price-changing amendment', () => {
  assert.match(review, /\| 'CURRENCY_CHANGED'/);
  assert.match(review, /blocker = 'CURRENCY_CHANGED'/);
  assert.match(review, /blocker = 'PRICE_CHANGED'/);
  assert.match(page, /Correct the pricing configuration/);
  assert.match(authorityDocs, /pricing-configuration integrity blocker/i);
  assert.match(lifecycleDocs, /pricing-configuration drift/i);
});

test('staff review shows exact accepted target and delta evidence without exposing a commercial apply action', () => {
  assert.match(page, />Accepted booking amount</);
  assert.match(page, />Current target amount</);
  assert.match(page, />Commercial impact</);
  assert.match(page, /moneyMinorToMajorString\(impact\.deltaMinor, impact\.acceptedCurrency\)/);
  assert.match(page, /review\.ready && review\.authorityFingerprint && canApply/);
  assert.doesNotMatch(page, /Apply commercial amendment/);
  assert.doesNotMatch(page, /Accept price change/);
  assert.match(authorityDocs, /exposes no apply action for a commercial change/i);
  assert.match(lifecycleDocs, /Apply is rendered only for a price-neutral ready review/i);
});
