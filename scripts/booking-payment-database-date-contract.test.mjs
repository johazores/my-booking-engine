import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('hospitality booking and manual payment fixtures use PostgreSQL-relative dates', () => {
  const booking = readFileSync(new URL('src/server/bookings/hospitality-booking.integration.ts', root), 'utf8');
  const payment = readFileSync(new URL('src/server/payments/payment.integration.ts', root), 'utf8');

  for (const [name, source] of [['booking', booking], ['payment', payment]]) {
    assert.match(source, /SELECT clock_timestamp\(\) AS now/, name);
    assert.doesNotMatch(source, /2026-09-\d\d/, name + ': expired fixture dates');
    assert.match(source, /await db\.\$disconnect\(\)/, name);
  }

  assert.ok(booking.indexOf('  try {') < booking.indexOf('SELECT clock_timestamp() AS now'), 'booking clock read is guarded by teardown');
  assert.match(booking, /startDate: dateAt\(0\)/);
  assert.match(booking, /endDate: dateAt\(29\)/);
  assert.match(booking, /arrivalDate: dateAt\(9\), departureDate: dateAt\(11\)/);
  assert.match(booking, /const cancelledAt = new Date\(now\.getTime\(\) \+ 36 \* 60 \* 60 \* 1000\)/);
  assert.match(booking, /new Date\(now\.getTime\(\) \+ 48 \* 60 \* 60 \* 1000\)/);

  assert.ok(payment.indexOf('  t.after(async () => {') < payment.indexOf('SELECT clock_timestamp() AS now'), 'payment teardown precedes clock read');
  assert.match(payment, /const arrivalDate = new Date\(Date\.UTC\(/);
  assert.match(payment, /const departureDate = new Date\(Date\.UTC\(/);
  assert.match(payment, /expiresAt: new Date\(now\.getTime\(\) \+ 3_600_000\)/);
  assert.match(payment, /endedAt: settledAt/);
  assert.match(payment, /confirmedAt: settledAt/);
});

test('future payment stay dates remain adjacent at month and year boundaries', () => {
  for (const timestamp of ['2026-12-31T23:59:59.000Z', '2028-02-29T10:00:00.000Z']) {
    const now = new Date(timestamp);
    const arrivalDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 30));
    const departureDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 31));
    assert.equal(departureDate.getTime() - arrivalDate.getTime(), 86_400_000);
    assert.ok(arrivalDate.getTime() > now.getTime());
  }
});
