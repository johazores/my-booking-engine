import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Source-level safety regression. Real teardown still requires disposable PostgreSQL.
const suites = [
  ['../src/server/inventory/rental-database-integrity.integration.ts', [], ['organization']],
  ['../src/server/inventory/rental-inventory.integration.ts', ['adminA', 'staffUserA', 'adminB'], ['organizationA', 'organizationB']],
  ['../src/server/inventory/rental-hold.integration.ts', ['adminA', 'staffA', 'adminB'], ['organizationA', 'organizationB']],
  ['../src/server/bookings/rental-booking.integration.ts', ['admin', 'otherAdmin'], ['organization', 'otherOrganization']],
  ['../src/server/bookings/rental-booking-source-evidence.integration.ts', ['admin'], ['organization']],
];

for (const [path, users, organizations] of suites) {
  test(`${path} registers tenant-scoped cleanup before fixture writes`, () => {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    const cleanupStart = source.indexOf('async function cleanupFixtures()');
    const registration = source.indexOf('t.after(cleanupFixtures);');
    const firstWrite = source.search(/await db\.(?:user|organization)\.create\(/);
    assert.ok(cleanupStart > 0 && registration > cleanupStart && firstWrite > registration);
    const cleanup = source.slice(cleanupStart, registration);
    assert.match(cleanup, /if \(fixturesCleaned\) return;/);
    assert.match(cleanup, /fixturesCleaned = true;/);
    assert.match(cleanup, /try \{[\s\S]*fixturesCleaned = true;\s*\} finally \{\s*await db\.\$disconnect\(\);\s*\}/);
    assert.match(source, /finally \{\s*await cleanupFixtures\(\);/);
    assert.match(cleanup, /db\.organization\.deleteMany/);
    assert.doesNotMatch(cleanup, /TRUNCATE|session_replication_role|DISABLE TRIGGER/i);
    if (users.length) assert.match(cleanup, /db\.user\.deleteMany/);
    for (const name of [...users, ...organizations]) {
      assert.ok(source.includes(`const ${name}Id = crypto.randomUUID();`), `${name} has a preassigned ID`);
      assert.ok(source.includes(`id: ${name}Id,`), `${name} uses the preassigned ID`);
      assert.ok(cleanup.includes(`${name}Id`), `${name} cleanup survives a failed create`);
    }
  });
}
