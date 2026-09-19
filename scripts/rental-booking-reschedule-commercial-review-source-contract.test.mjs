import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const domain = readFileSync('src/server/bookings/rental-booking-reschedule-domain.ts', 'utf8');
const review = readFileSync('src/server/bookings/rental-booking-reschedule-authority-service.ts', 'utf8');
const page = readFileSync('app/inventory/rentals/bookings/[booking-id]/reschedule/page.tsx', 'utf8');
const authorityDocs = readFileSync('docs/rental-booking-reschedule-authority.md', 'utf8');
const lifecycleDocs = readFileSync('docs/rental-booking-reschedule-lifecycle.md', 'utf8');

test('reschedule authority derives commercial impact from accepted effective money and fresh pricing', () => {
  assert.match(domain, /buildRentalBookingRescheduleCommercialImpact/);
  assert.match(domain, /acceptedTotalMinor/);
  assert.match(domain, /targetTotalMinor/);
  assert.match(domain, /kind: 'CURRENCY_CHANGED'/);
  assert.match(domain, /signedDeltaMinor/);

  assert.match(review, /buildRentalBookingRescheduleCommercialImpact\(\{/);
  assert.match(review, /acceptedCurrency:/);
  assert.match(review, /acceptedTotalMinor:/);
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

test('staff review keeps direct price-neutral apply separate from the protected commercial preparation handoff', () => {
  assert.match(page, />Accepted effective amount</);
  assert.match(page, />Current target amount</);
  assert.match(page, />Commercial impact</);
  assert.match(page, /moneyMinorToMajorString\(impact\.deltaMinor, impact\.acceptedCurrency\)/);
  assert.match(page, /review\.ready && review\.authorityFingerprint && canApply/);
  assert.match(page, /commercialAmendmentFingerprint/);
  assert.match(page, /Prepare commercial amendment/);
  assert.match(page, /payment:read/);
  assert.match(page, /payment:manage/);
  assert.doesNotMatch(page, /Apply commercial amendment/);
  assert.doesNotMatch(page, /Accept price change/);
  assert.match(authorityDocs, /price-neutral direct Apply form separate from the price-changing Prepare commercial amendment form/i);
  assert.match(lifecycleDocs, /Apply is rendered only for a price-neutral ready review/i);
  assert.match(lifecycleDocs, /commercial preparation action/i);
});

test('post-apply review uses accepted effective commercial money and blocks a second price-changing amendment', () => {
  assert.match(review, /effectiveAcceptedTotalMinor = existingCommercialAmendment\.afterTotalMinor/);
  assert.match(review, /COMMERCIAL_AMENDMENT_APPLIED/);
  assert.match(page, /Accepted effective amount/);
  assert.match(page, /Original booking amount/);
  assert.match(authorityDocs, /one applied price-changing rental amendment/i);
  assert.match(lifecycleDocs, /second\/chained price-changing amendment/i);
});
