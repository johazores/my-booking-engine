import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');
const domain = read('src/server/bookings/rental-booking-commercial-amendment-settlement-domain.ts');
const service = read('src/server/bookings/rental-booking-commercial-amendment-settlement-service.ts');
const page = read('app/inventory/rentals/bookings/[booking-id]/commercial-amendments/[amendment-id]/page.tsx');
const route = read('app/api/inventory/rentals/bookings/[booking-id]/commercial-amendments/[amendment-id]/route.ts');
const docs = read('docs/rental-booking-commercial-amendment-settlement.md');

test('pre-apply refund source is derived from complete reconciled server history', () => {
  for (const token of [
    'readRentalPaymentSettlementHistory',
    'deriveRentalPaymentSettlement',
    'deriveBookingSettlementSummary',
    'deriveRentalBookingCommercialAmendmentRefundSource',
    "purpose: 'ADJUSTMENT'",
    "kind: 'REFUND'",
    'sourceProviderReference = source.providerReference',
  ]) assert.ok(service.includes(token), `missing refund-source authority token: ${token}`);
  assert.match(domain, /deriveNextBookingRefundSource/);
  assert.match(domain, /allocation\.sourceRefundableMinor < input\.deltaMinor/);
  assert.match(domain, /priorAmendmentRefunds/);
});

test('browser cannot select the pre-apply refund source', () => {
  assert.match(page, /Server-selected refund source/);
  assert.match(page, /commercial\.adjustmentRefundSource/);
  assert.doesNotMatch(page, /name="sourceProviderReference"/);
  assert.doesNotMatch(page, /listRentalBookingPaymentTransactions/);
  assert.doesNotMatch(route, /sourceProviderReference/);
  assert.doesNotMatch(service, /sourceProviderReference\?: unknown/);
});

test('readiness and expiry use PostgreSQL authority rather than application clock', () => {
  assert.match(service, /SELECT clock_timestamp\(\) AS "now"/);
  assert.match(service, /preparationLive/);
  assert.match(page, /commercial\.preparationLive/);
  assert.doesNotMatch(page, /Date\.now\(\)/);
});

test('documentation states the exact one-source server authority boundary', () => {
  assert.match(docs, /browser submits only the new real-world refund reference/i);
  assert.match(docs, /largest remaining refundable capacity/i);
  assert.match(docs, /fails closed if no single source can cover/i);
  assert.match(docs, /PostgreSQL `clock_timestamp\(\)`/);
});
