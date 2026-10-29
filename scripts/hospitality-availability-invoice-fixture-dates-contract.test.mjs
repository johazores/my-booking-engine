import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const fixturePaths = [
  'src/server/availability/hospitality-availability.integration.ts',
  'src/server/availability/hospitality-availability-hold.integration.ts',
  'src/server/inventory/hospitality-restriction.integration.ts',
  'src/server/payments/hospitality-invoice-preparation.integration.ts',
  'src/server/payments/hospitality-invoice-issuance.integration.ts',
];

test('availability, restriction, and invoice database fixtures use a live PostgreSQL calendar anchor', () => {
  for (const path of fixturePaths) {
    const source = readFileSync(join(process.cwd(), path), 'utf8');
    assert.match(source, /SELECT clock_timestamp\(\) AS now/, path);
    assert.match(source, /const dateAt = \(days: number\)/, path);
    assert.doesNotMatch(source, /20(?:26|27)-(?:09|10|11|12)-\d\d/, `${path}: stale fixed fixture date`);
  }
});

test('availability and restriction fixture teardown disconnects Prisma even after cleanup failure', () => {
  for (const path of fixturePaths.slice(0, 3)) {
    const source = readFileSync(join(process.cwd(), path), 'utf8');
    assert.match(source, /t\.after\(async \(\) => \{\s*try \{\s*await cleanupFixtures\(\);\s*\} finally \{\s*await db\.\$disconnect\(\);\s*\}\s*\}\);/, path);
  }
});

test('invoice fixture hold and confirmation chronology follows the same database clock', () => {
  for (const path of fixturePaths.slice(3)) {
    const source = readFileSync(join(process.cwd(), path), 'utf8');
    assert.match(source, /const expiresAt = new Date\(now\.getTime\(\) \+ 3_600_000\)/, path);
    assert.match(source, /const confirmedAt = new Date\(now\.getTime\(\) \+ 60_000\)/, path);
    assert.match(source, /nightly: \[\{ date: dateAt\(0\)/, path);
    assert.match(source, /arrivalDate: dateAt\(0\),\s*departureDate: dateAt\(1\)/, path);
  }
});

test('future-relative UTC fixture calendar preserves adjacent days across year and leap boundaries', () => {
  for (const timestamp of ['2026-12-31T23:59:59.000Z', '2028-02-28T12:00:00.000Z', '2028-02-29T12:00:00.000Z']) {
    const now = new Date(timestamp);
    const dateAt = (days) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 30 + days)).toISOString().slice(0, 10);
    const first = Date.parse(`${dateAt(0)}T00:00:00.000Z`);
    const second = Date.parse(`${dateAt(1)}T00:00:00.000Z`);
    assert.equal(second - first, 86_400_000);
    assert.ok(first > now.getTime());
    assert.ok(Date.parse(`${dateAt(33)}T00:00:00.000Z`) > second);
  }
});
