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

void test('rental booking authority requires booking, availability, inventory, pricing, and customer authorization', () => {
  for (const permission of ['booking:manage', 'availability:read', 'inventory:read', 'pricing:read', 'customer:read']) {
    assert.ok(service.includes(`permission: '${permission}'`), `missing permission ${permission}`);
  }
  assert.ok(service.includes('organizationId: input.organizationId'));
  assert.match(service, /customer\.findFirst\([\s\S]*organizationId: input\.organizationId[\s\S]*status: 'ACTIVE'/);
  assert.match(service, /rentalAvailabilityHold\.findFirst\([\s\S]*organizationId: input\.organizationId[\s\S]*status: 'ACTIVE'[\s\S]*expiresAt: \{ gt: databaseClock\.now \}/);
});

void test('rental booking authority revalidates inventory, booked allocation, and current pricing from persisted tenant data', () => {
  assert.ok(service.includes('SELECT clock_timestamp() AS "now"'));
  assert.ok(service.includes('rentalAvailabilityBlock.findFirst'));
  assert.ok(service.includes('id: { not: hold.id }'));
  assert.ok(service.includes('rentalBookingAllocation.findFirst'));
  assert.ok(service.includes("status: { not: 'CANCELLED' }"));
  assert.ok(service.includes('buildRentalPricingEvidence'));
  assert.ok(service.includes('LEGACY_PRICING_EVIDENCE'));
  assert.ok(service.includes('PRICE_CHANGED'));
  assert.ok(service.includes('INVENTORY_CONFLICT'));
  assert.ok(service.includes("isolationLevel: 'Serializable'"));
});

void test('authority fingerprint binds tenant, customer, hold, unit, location, dates, expiry, and exact money', () => {
  for (const token of [
    'organizationId', 'holdId', 'customerId', 'unitId', 'unitTypeId', 'locationId',
    'startsOn', 'endsOn', 'holdExpiresAt', 'currency', 'totalMinor', 'pricingFingerprint',
  ]) {
    assert.ok(domain.includes(token), `missing authority token ${token}`);
  }
  assert.ok(domain.includes('sf:rental-booking-conversion-authority:v1'));
  assert.ok(domain.includes("createHash('sha256')"));
});

void test('authority review remains read-only while the durable writer independently rechecks current truth', () => {
  assert.doesNotMatch(service, /\.create\(|\.update\(|\.updateMany\(|\.delete\(|\.deleteMany\(/);
  assert.match(docs, /review itself does \*\*not\*\* create a rental booking/i);
  assert.match(docs, /writer does not trust a previously successful review as current truth/i);
  assert.match(docs, /revalidates the active hold, customer, inventory conflicts, current price, and the exact authority fingerprint/i);
});
