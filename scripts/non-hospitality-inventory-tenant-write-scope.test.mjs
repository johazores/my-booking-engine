import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function assertArchivedWriteIsTenantScoped(service, modelName) {
  const pattern = new RegExp(
    `${modelName}\\.update\\(\\{\\s*where: \\{ id: current\\.id, organizationId: input\\.organizationId \\},\\s*data: \\{ status: 'ARCHIVED', archivedAt \\}`,
  );
  assert.match(service, pattern, `${modelName} archive write must repeat organizationId`);

  const unsafe = new RegExp(`${modelName}\\.update\\(\\{\\s*where: \\{ id: current\\.id \\}`);
  assert.doesNotMatch(service, unsafe, `${modelName} archive write must not be ID-only`);
}

test('tour lifecycle writes repeat tenant scope at mutation time', () => {
  const service = source('src/server/inventory/tour-service.ts');

  assert.match(service, /permission: 'inventory:manage'/);
  assertArchivedWriteIsTenantScoped(service, 'tourDeparture');
  assertArchivedWriteIsTenantScoped(service, 'tourAddon');
  assertArchivedWriteIsTenantScoped(service, 'tourProduct');
});

test('appointment lifecycle writes repeat tenant scope at mutation time', () => {
  const service = source('src/server/inventory/appointment-service.ts');

  assert.match(service, /permission: 'inventory:manage'/);
  assertArchivedWriteIsTenantScoped(service, 'appointmentSchedule');
  assertArchivedWriteIsTenantScoped(service, 'appointmentService');
  assertArchivedWriteIsTenantScoped(service, 'appointmentStaff');
  assert.match(
    service,
    /appointmentStaffService\.delete\(\{\s*where: \{\s*organizationId_staffId_serviceId: \{\s*organizationId: input\.organizationId/,
  );
});

test('non-hospitality inventory tenant write-scope documentation records the sweep boundary', () => {
  const document = source('docs/non-hospitality-inventory-tenant-write-scope.md');

  assert.match(document, /rental, tour, and appointment/i);
  assert.match(document, /final update or delete predicate/i);
  assert.match(document, /inventory:manage/i);
  assert.match(document, /separate review/i);
  assert.match(document, /no GitHub Actions/i);
});
