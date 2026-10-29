import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const coreSuites = [
  "src/server/tenancy/tenant-isolation.integration.ts",
  "src/server/authorization/authorization.integration.ts",
  "src/server/organizations/organization-management.integration.ts",
  "src/server/branding/branding.integration.ts",
  "src/server/customers/customer.integration.ts"
];

test('core database fixtures register cleanup before the first write and use preassigned IDs', () => {
  for (const path of coreSuites) {
    const source = readFileSync(new URL(path, root), 'utf8');
    assert.ok(source.indexOf('  try {') >= 0 && source.indexOf('db.user.create(') > source.indexOf('  try {'), path);
    assert.ok(source.includes('crypto.randomUUID()'), path);
    assert.ok(source.includes('id: '), path);
    for (const operation of ['organizationMembership.deleteMany', 'organization.deleteMany', 'user.deleteMany', '$disconnect()']) {
      assert.ok(source.includes(operation), path + ': ' + operation);
    }
    assert.equal(source.includes('createdUserIds.push'), false, path);
    assert.equal(source.includes('createdOrganizationIds.push'), false, path);
  }
});

test('auth registration cleans by email even without a returned user ID', () => {
  const source = readFileSync(new URL('src/server/auth/auth-persistence.integration.ts', root), 'utf8');
  assert.ok(source.includes('await db.user.deleteMany({ where: { email } })'));
  assert.ok(source.includes('await db.$disconnect()'));
});

test('tenant and authorization fixture inserts do not race teardown', () => {
  for (const path of coreSuites.slice(0, 2)) {
    const source = readFileSync(new URL(path, root), 'utf8');
    assert.equal(source.includes('await Promise.all([\n      db.user.create('), false, path);
    assert.equal(source.includes('await Promise.all([\n      db.organization.create('), false, path);
    assert.equal(source.includes('await Promise.all([\n      db.organizationMembership.create('), false, path);
  }
});
