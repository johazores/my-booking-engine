import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('tour departures use a future PostgreSQL date and product-timezone examples', () => {
  const suite = readFileSync(new URL('src/server/inventory/tour-inventory.integration.ts', root), 'utf8');
  const page = readFileSync(new URL('app/inventory/tours/[tour-id]/page.tsx', root), 'utf8');

  assert.match(suite, /SELECT clock_timestamp\(\) AS now/);
  assert.match(suite, /const start =/);
  assert.match(suite, /const end =/);
  assert.match(suite, /const conflictingEnd =/);
  assert.doesNotMatch(suite, /2026-10-05/);
  assert.match(page, /function formatDepartureExample\(timezone: string, hour: number\)/);
  assert.match(page, /timeZoneName: 'longOffset'/);
  assert.match(page, /formatDepartureExample\(product\.timezone, 8\)/);
  assert.match(page, /formatDepartureExample\(product\.timezone, 17\)/);
  assert.match(page, /placeholder=\{startExample\}/);
  assert.match(page, /placeholder=\{endExample\}/);
  assert.doesNotMatch(page, /2026-10-05/);
});

test('IANA timezone examples retain the expected offset and local date', () => {
  const future = new Date('2027-03-15T12:00:00.000Z');
  for (const [timezone, expected] of [['Asia/Manila', 'GMT+08:00'], ['UTC', 'GMT'], ['America/New_York', 'GMT-04:00']]) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', timeZoneName: 'longOffset',
    }).formatToParts(future);
    assert.equal(parts.find((entry) => entry.type === 'timeZoneName')?.value, expected);
  }
});
