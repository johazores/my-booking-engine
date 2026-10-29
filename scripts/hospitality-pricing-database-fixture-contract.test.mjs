import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const suites = [
  'src/server/pricing/hospitality-pricing.integration.ts',
  'src/server/pricing/hospitality-charge.integration.ts',
  'src/server/pricing/hospitality-addon.integration.ts',
];

test('hospitality pricing database fixtures close Prisma and use future PostgreSQL-relative dates', () => {
  for (const path of suites) {
    const source = readFileSync(new URL(path, root), 'utf8');
    const cleanup = source.indexOf('  t.after(async () => {');
    const clock = source.indexOf('SELECT clock_timestamp() AS now');
    const firstWrite = source.search(/await db\.(?:user|organization)\.create\(/);
    assert.ok(cleanup >= 0 && cleanup < clock && clock < firstWrite, path + ': register cleanup before clock read and fixture writes');
    assert.match(source, /t\.after\(async \(\) => \{\s+try \{\s+await cleanupFixtures\(\);\s+\} finally \{\s+await db\.\$disconnect\(\);\s+\}\s+\}\);/, path);
    assert.equal((source.match(/await db\.\$disconnect\(\)/g) ?? []).length, 1, path);
    assert.match(source, /const dateAt = \(days: number\) =>/, path);
    assert.doesNotMatch(source, /2026-09-\d\d|2026-10-\d\d/, path + ': expired fixed fixture date');
    assert.match(source, /startDate: dateAt\(0\), endDate: dateAt\(29\)/, path);
    assert.match(source, /arrivalDate: dateAt\(9\), departureDate: dateAt\(11\)/, path);
    assert.match(source, /dateAt\(30\)/, path);
  }
});

test('UTC calendar-day offsets preserve pricing windows across year-end and leap days', () => {
  for (const timestamp of ['2026-12-31T23:59:59.000Z', '2028-02-28T00:01:00.000Z', '2028-02-29T12:00:00.000Z']) {
    const now = new Date(timestamp);
    const dateAt = (days) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 30 + days)).toISOString().slice(0, 10);
    const toTime = (day) => Date.parse(day + 'T00:00:00.000Z');
    assert.equal((toTime(dateAt(29)) - toTime(dateAt(0))) / 86_400_000, 29);
    assert.equal((toTime(dateAt(30)) - toTime(dateAt(29))) / 86_400_000, 1);
    assert.equal((toTime(dateAt(11)) - toTime(dateAt(9))) / 86_400_000, 2);
    assert.ok(toTime(dateAt(0)) > toTime(timestamp.slice(0, 10)));
  }
});
