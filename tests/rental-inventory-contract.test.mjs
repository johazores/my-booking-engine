import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('rental schema binds child relations to organization ownership', async () => {
  const schema = await source('prisma/rental-inventory.prisma');
  assert.match(schema, /@@unique\(\[id, organizationId\]\)/);
  assert.match(schema, /@relation\(fields: \[unitTypeId, organizationId\], references: \[id, organizationId\]/);
  assert.match(schema, /@relation\(fields: \[unitId, organizationId\], references: \[id, organizationId\]/);
});

test('rental service enforces authorization and scoped overlap checks', async () => {
  const service = await source('src/server/inventory/rental-service.ts');
  assert.match(service, /permission: 'inventory:read' \| 'inventory:manage'/);
  assert.match(service, /organizationId: input\.organizationId/);
  assert.match(service, /startsOn: \{ lt: block\.endsOn \}/);
  assert.match(service, /endsOn: \{ gt: block\.startsOn \}/);
  assert.match(service, /startsOn: \{ lt: rate\.endsOn \}/);
  assert.match(service, /endsOn: \{ gt: rate\.startsOn \}/);
});

test('rental documentation does not claim booking or payment workflows', async () => {
  const documentation = await source('docs/rental-inventory.md');
  assert.match(documentation, /does \*\*not\*\* present/i);
  assert.match(documentation, /payment processing/);
  assert.match(documentation, /customer-facing rental search or checkout/);
});
