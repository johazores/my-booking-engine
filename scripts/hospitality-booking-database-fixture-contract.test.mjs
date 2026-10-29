import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const suites = [
  ['src/server/bookings/hospitality-booking-version-authority.integration.ts', 1, 1, true],
  ['src/server/bookings/hospitality-cancelled-allocation-history-integrity.integration.ts', 1, 1, true],
  ['src/server/bookings/hospitality-booking-guest-evidence-integrity.integration.ts', 1, 1, true],
  ['src/server/bookings/hospitality-booking-pricing-evidence-integrity.integration.ts', 1, 1, true],
  ['src/server/bookings/hospitality-booking-reschedule.integration.ts', 3, 2, true],
  ['src/server/bookings/hospitality-booking-commercial-modification.integration.ts', 3, 2, true],
  ['src/server/bookings/hospitality-booking-guest-modification.integration.ts', 3, 2, true],
  ['src/server/bookings/public-hospitality-confirmation.integration.ts', 1, 2, false],
  ['src/server/bookings/public-hospitality-hold.integration.ts', 0, 2, false],
  ['src/server/bookings/public-booking-principal.integration.ts', 2, 2, true],
];

test('hospitality booking and public capability fixtures guard partial setup and disconnect', () => {
  for (const [path, userCount, organizationCount, usesDatabaseClock] of suites) {
    const source = readFileSync(new URL(path, root), 'utf8');
    const guard = source.indexOf('  try {', source.indexOf('const runId = crypto.randomUUID()'));
    const firstWrite = source.search(/await db\.(?:user|organization)\.create\(/);
    assert.ok(guard >= 0 && firstWrite > guard, `${path}: guard must precede fixture writes`);
    const setup = source.slice(guard, source.indexOf('    const customer =', guard) > 0 ? source.indexOf('    const customer =', guard) : source.length);
    if (organizationCount === 1) {
      assert.match(setup, /id: organizationId, name:/, path);
      assert.match(setup, /id: adminId, email:/, path);
    } else {
      for (let i = 0; i < organizationCount; i++) {
        assert.ok(setup.includes(`id: organizationIds[${i}], name:`), `${path}: organization ${i}`);
      }
      for (let i = 0; i < userCount; i++) {
        assert.ok(setup.includes(`id: userIds[${i}], email:`), `${path}: user ${i}`);
      }
    }
    const cleanup = source.slice(source.lastIndexOf('\n  } finally {'));
    assert.match(cleanup, /organization\.deleteMany\(/, path);
    if (userCount) assert.match(cleanup, /user\.deleteMany\(/, path);
    assert.match(cleanup, /\} finally \{\s+await db\.\$disconnect\(\);/, path);
    assert.equal((source.match(/await db\.\$disconnect\(\)/g) ?? []).length, 1, path);
    assert.ok(cleanup.includes(organizationCount === 1 ? 'organizationId' : 'organizationIds'), path);
    if (usesDatabaseClock) {
      assert.match(source, /SELECT clock_timestamp\(\) AS now/, path);
      assert.match(source, /const dateAt = \(days: number\)/, path);
      assert.doesNotMatch(source, /2026-09-\d\d|2026-10-\d\d/, `${path}: expired hardcoded fixture date`);
    }
  }
});
