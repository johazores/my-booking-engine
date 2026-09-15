import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function matches(sourceText, pattern) {
  return [...sourceText.matchAll(pattern)].length;
}

test('customer mutations retain tenant and lifecycle scope at the final write', () => {
  const customers = source('src/server/customers/customer-service.ts');

  assert.equal(
    matches(customers, /customer\.update\(\{\s*where: \{ id: current\.id, organizationId: input\.organizationId, status: 'ACTIVE' \}/g),
    2,
  );
  assert.equal(
    matches(customers, /customer\.update\(\{\s*where: \{ id: current\.id, organizationId: input\.organizationId, status: 'ARCHIVED' \}/g),
    1,
  );
  assert.doesNotMatch(customers, /customer\.update\(\{\s*where: \{ id: current\.id \}/);
});

test('membership role and lifecycle writes retain organization and expected state', () => {
  const roleService = source('src/server/memberships/membership-role-service.ts');
  const statusService = source('src/server/memberships/membership-status-service.ts');
  const guardedWhere = /organizationMembership\.update\(\{\s*where: \{\s*id: membership\.id,\s*organizationId: input\.organizationId,\s*role: membership\.role,\s*status: membership\.status,?\s*\}/;

  assert.match(roleService, guardedWhere);
  assert.match(statusService, guardedWhere);
  assert.doesNotMatch(roleService, /organizationMembership\.update\(\{\s*where: \{ id: membership\.id \}/);
  assert.doesNotMatch(statusService, /organizationMembership\.update\(\{\s*where: \{ id: membership\.id \}/);
  assert.match(roleService, /isolationLevel: 'Serializable'/);
  assert.match(statusService, /isolationLevel: 'Serializable'/);
});

test('branding and organization root writes retain authorized lifecycle scope', () => {
  const branding = source('src/server/branding/branding-service.ts');
  const organizations = source('src/server/organizations/organization-management-service.ts');
  const rootWhere = /organization\.update\(\{\s*where: \{ id: input\.organizationId, status: 'ACTIVE', deletedAt: null \}/g;

  assert.equal(matches(branding, rootWhere), 1);
  assert.equal(matches(organizations, rootWhere), 2);
  assert.doesNotMatch(branding, /organization\.update\(\{\s*where: \{ id: current\.id \}/);
  assert.doesNotMatch(organizations, /organization\.update\(\{\s*where: \{ id: current\.id \}/);
});

test('core write-scope documentation records the production boundary', () => {
  const document = source('docs/core-tenant-write-scope.md');
  const tenancy = source('docs/tenant-system.md');

  assert.match(document, /customer, membership, branding, and organization-management/i);
  assert.match(document, /final persistence mutation/i);
  assert.match(document, /defense in depth/i);
  assert.match(document, /Payment, refund, reconciliation, invoice, adjustment-note, supplier/i);
  assert.match(document, /GitHub Actions are intentionally not used/i);
  assert.doesNotMatch(tenancy, /There are no tenant-owned write APIs yet/i);
  assert.match(tenancy, /write-time ownership/i);
});
