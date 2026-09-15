import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const servicePath = new URL('../src/server/bookings/rental-booking-authority-service.ts', import.meta.url);
const domainPath = new URL('../src/server/bookings/rental-booking-authority-domain.ts', import.meta.url);
const docsPath = new URL('../docs/rental-booking-authority.md', import.meta.url);

const [service, domain, docs] = await Promise.all([
  readFile(servicePath, 'utf8'),
  readFile(domainPath, 'utf8'),
  readFile(docsPath, 'utf8'),
]);

test('rental booking authority requires booking, availability, inventory, pricing, and customer authorization', () => {
  for (const permission of ['booking:manage', 'availability:read', 'inventory:read', 'pricing:read', 'customer:read']) {
    assert.match(service, new RegExp(`permission: '${permission.replace(':', '\\:')}'`));
  }
  assert.match(service, /organizationId: input\.organizationId/);
  assert.match(service, /customer\.findFirst\(\{[\s\S]*organizationId: input\.organizationId[\s\S]*status: 'ACTIVE'/);
  assert.match(service, /rentalAvailabilityHold\.findFirst\(\{[\s\S]*organizationId: input\.organizationId[\s\S]*status: 'ACTIVE'[\s\S]*expiresAt: \{ gt: databaseClock\.now \}/);
});

test('rental booking authority revalidates inventory and current pricing from persisted tenant data', () => {
  assert.match(service, /SELECT clock_timestamp\(\) AS "now"/);
  assert.match(service, /rentalAvailabilityBlock\.findFirst/);
  assert.match(service, /id: \{ not: hold\.id \}/);
  assert.match(service, /buildRentalPricingEvidence/);
  assert.match(service, /LEGACY_PRICING_EVIDENCE/);
  assert.match(service, /PRICE_CHANGED/);
  assert.match(service, /INVENTORY_CONFLICT/);
  assert.match(service, /isolationLevel: 'Serializable'/);
});

test('authority fingerprint binds tenant, customer, hold, unit, location, dates, expiry, and exact money', () => {
  for (const token of [
    'organizationId', 'holdId', 'customerId', 'unitId', 'unitTypeId', 'locationId',
    'startsOn', 'endsOn', 'holdExpiresAt', 'currency', 'totalMinor', 'pricingFingerprint',
  ]) {
    assert.match(domain, new RegExp(token));
  }
  assert.match(domain, /sf:rental-booking-conversion-authority:v1/);
  assert.match(domain, /createHash\('sha256'\)/);
});

test('authority review remains read-only and does not present a fake booking workflow', () => {
  assert.doesNotMatch(service, /\.create\(|\.update\(|\.updateMany\(|\.delete\(|\.deleteMany\(/);
  assert.match(docs, /does not create a rental booking/i);
  assert.match(docs, /no customer or staff booking action/i);
  assert.match(docs, /must revalidate this authority again inside the future write transaction/i);
});
