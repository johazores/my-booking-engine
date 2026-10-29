import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const suites = [
  [
    "src/server/inventory/hospitality.integration.ts",
    [
      "adminA",
      "staffA",
      "adminB",
      "organizationA",
      "organizationB"
    ]
  ],
  [
    "src/server/inventory/hospitality-rate-plan.integration.ts",
    [
      "adminA",
      "staffA",
      "adminB",
      "organizationA",
      "organizationB"
    ]
  ],
  [
    "src/server/inventory/hospitality-restriction.integration.ts",
    [
      "adminA",
      "staffA",
      "adminB",
      "organizationA",
      "organizationB"
    ]
  ],
  [
    "src/server/availability/hospitality-availability.integration.ts",
    [
      "adminA",
      "staffA",
      "adminB",
      "organizationA",
      "organizationB"
    ]
  ],
  [
    "src/server/availability/hospitality-availability-hold.integration.ts",
    [
      "adminA",
      "staffA",
      "adminB",
      "organizationA",
      "organizationB"
    ]
  ],
  [
    "src/server/pricing/hospitality-pricing.integration.ts",
    [
      "adminA",
      "staffA",
      "adminB",
      "organizationA",
      "organizationB"
    ]
  ],
  [
    "src/server/pricing/hospitality-charge.integration.ts",
    [
      "admin",
      "staff",
      "outsider",
      "organization",
      "otherOrganization"
    ]
  ],
  [
    "src/server/pricing/hospitality-addon.integration.ts",
    [
      "admin",
      "staff",
      "outsider",
      "organization",
      "otherOrganization"
    ]
  ]
];

test('hospitality inventory, availability, and pricing fixtures clean up partial setup safely', () => {
  for (const [path, identities] of suites) {
    const source = readFileSync(new URL('../' + path, import.meta.url), 'utf8');
    const cleanupHook = source.indexOf('t.after(cleanupFixtures);');
    const firstWrite = source.indexOf('await db.user.create(');
    assert.ok(cleanupHook > 0 && firstWrite > cleanupHook, path + ': cleanup must precede fixture writes');
    assert.match(source, /async \(t\) => \{/);
    for (const identity of identities) {
      const table = /organization/i.test(identity) ? 'organization' : 'user';
      assert.ok(source.includes('const ' + identity + 'Id = crypto.randomUUID();'), path + ': missing preassigned ID for ' + identity);
      assert.ok(source.includes('const ' + identity + ' = await db.' + table + '.create({ data: { id: ' + identity + 'Id,'), path + ': creation must use preassigned ID for ' + identity);
    }
    const cleanupStart = source.indexOf('async function cleanupFixtures() {');
    const cleanup = source.slice(cleanupStart, cleanupHook);
    assert.ok(cleanupStart > 0, path + ': missing cleanup helper');
    assert.match(cleanup, /if \(fixturesCleaned\) return;/);
    assert.match(cleanup, /fixturesCleaned = true;/);
    assert.match(cleanup, /await db\.auditEvent\.deleteMany/);
    assert.match(cleanup, /await db\.organizationMembership\.deleteMany/);
    assert.match(cleanup, /await db\.organization\.deleteMany/);
    assert.match(cleanup, /await db\.user\.deleteMany/);
    assert.doesNotMatch(cleanup, /\b(?:adminA|staffA|adminB|admin|staff|outsider|organizationA|organizationB|organization|otherOrganization)\.id\b/);
    assert.doesNotMatch(cleanup, /await db\.\w+\.delete\(/);
    assert.match(source, /} finally \{\s*await cleanupFixtures\(\);\s*\}/);
  }
});
