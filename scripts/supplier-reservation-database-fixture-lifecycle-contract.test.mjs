import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Source-level safety checks; actual PostgreSQL behavior requires npm run test:database.
const suites = [
  {
    "path": "src/server/suppliers/hospitality-supplier-reservation.integration.ts",
    "users": [
      "tenantAAdmin",
      "tenantBAdmin"
    ],
    "orgs": [
      "tenantA",
      "tenantB"
    ]
  },
  {
    "path": "src/server/suppliers/hospitality-supplier-reservation-confirmation-evidence.integration.ts",
    "users": [
      "admin"
    ],
    "orgs": [
      "organization"
    ]
  },
  {
    "path": "src/server/suppliers/hospitality-supplier-reservation-attempt-recovery.integration.ts",
    "users": [
      "tenantAAdmin",
      "tenantBAdmin"
    ],
    "orgs": [
      "tenantA",
      "tenantB"
    ]
  },
  {
    "path": "src/server/suppliers/hospitality-supplier-reservation-provider-evidence.integration.ts",
    "users": [],
    "orgs": [
      "organization"
    ]
  },
  {
    "path": "src/server/suppliers/hospitality-supplier-reservation-recovery-write.integration.ts",
    "users": [
      "admin"
    ],
    "orgs": [
      "organization"
    ]
  },
  {
    "path": "src/server/suppliers/hospitality-supplier-reservation-reconciliation.integration.ts",
    "users": [
      "tenantAAdmin",
      "tenantBAdmin"
    ],
    "orgs": [
      "tenantA",
      "tenantB"
    ]
  }
];

for (const { path, users, orgs } of suites) {
  test(`${path} registers partial-setup cleanup and disconnects Prisma`, () => {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    const registered = source.indexOf('t.after(cleanupFixtures);');
    const firstInsert = source.search(/await db\.(user|organization)\.create\(/);
    assert.ok(registered > 0 && firstInsert > registered, 'cleanup must be registered before fixture writes');
    assert.ok(!/2026-(10|11)-\d\d/.test(source), 'supplier fixture dates must not expire');
    assert.match(source, /const arrivalDate = new Date\(Date\.UTC\(/);
    assert.match(source, /const departureDate = new Date\(Date\.UTC\(/);
    assert.match(source, /async function cleanupFixtures\(\)/);
    assert.match(source, /if \(cleanupStarted\) return;/);
    assert.match(source, /cleanupStarted = true;/);
    assert.match(source, /finally \{\s*await db\.\$disconnect\(\);/);
    assert.match(source, /\} finally \{\s*await cleanupFixtures\(\);\s*\}\s*\}\);/);

    const cleanup = source.slice(source.indexOf('async function cleanupFixtures()'), registered);
    for (const name of [...users, ...orgs]) {
      assert.ok(source.includes(`const ${name}Id = crypto.randomUUID();`), `${name} ID must exist before writes`);
      assert.ok(!cleanup.includes(`${name}.id`), `${name} cleanup must not depend on create response`);
    }
    for (const name of users) {
      assert.ok(source.includes(`data: { id: ${name}Id,`), `${name} user create must use preassigned ID`);
    }
    for (const name of orgs) {
      assert.ok(source.includes(`id: ${name}Id,`), `${name} organization create must use preassigned ID`);
    }
    assert.ok(cleanup.indexOf('hospitalitySupplierReservationAttempt.deleteMany') <
      cleanup.indexOf('hospitalitySupplierReservationOperation.deleteMany'), 'delete attempts before operations');
    assert.ok(cleanup.indexOf('hospitalitySupplierReservationOperation.deleteMany') <
      cleanup.indexOf('integration.deleteMany'), 'delete operations before integrations');
    assert.ok(cleanup.includes('organization.deleteMany'), 'partial organization setup must allow no-op delete');
    if (users.length) assert.ok(cleanup.includes('user.deleteMany'), 'partial user setup must allow no-op delete');
  });
}
