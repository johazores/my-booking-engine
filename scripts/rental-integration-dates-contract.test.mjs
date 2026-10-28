import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { rentalIntegrationDateAtOffset } from '../src/server/testing/rental-integration-dates.ts';

test('rental integration dates are derived from the database clock across UTC year boundaries', () => {
  const clock = new Date('2026-12-28T23:59:59.000Z');
  assert.equal(rentalIntegrationDateAtOffset(clock, 7), '2027-01-04');
  assert.equal(rentalIntegrationDateAtOffset(clock, 14), '2027-01-11');
  assert.equal(rentalIntegrationDateAtOffset(clock, 17), '2027-01-14');
  assert.equal(rentalIntegrationDateAtOffset(clock, 35), '2027-02-01');
  assert.equal(rentalIntegrationDateAtOffset(clock, 0), '2026-12-28');
  assert.throws(() => rentalIntegrationDateAtOffset(new Date('invalid'), 14), /invalid/i);
  assert.throws(() => rentalIntegrationDateAtOffset(clock, -1), /invalid/i);
  assert.throws(() => rentalIntegrationDateAtOffset(clock, 1.5), /invalid/i);
});

const suites = [
  '../src/server/inventory/rental-hold.integration.ts',
  '../src/server/inventory/rental-inventory.integration.ts',
  '../src/server/bookings/rental-booking.integration.ts',
  '../src/server/bookings/rental-booking-source-evidence.integration.ts',
  '../src/server/payments/rental-payment.integration.ts',
];

for (const suite of suites) {
  test(`${suite} uses future relative rental windows instead of expiring fixed dates`, () => {
    const source = readFileSync(new URL(suite, import.meta.url), 'utf8');
    assert.match(source, /SELECT clock_timestamp\(\) AS "now"/);
    assert.match(source, /rentalIntegrationDateAtOffset\(databaseClock\.now, days\)/);
    assert.match(source, /dateAtOffset\(14\)/);
    assert.doesNotMatch(source, /['"]20\d{2}-\d{2}-\d{2}['"]/, 'booking/availability windows must not be fixed calendar dates');
    assert.ok(source.indexOf('clock_timestamp()') < source.indexOf('await db.user.create('), 'clock authority must precede fixture writes');
  });
}
