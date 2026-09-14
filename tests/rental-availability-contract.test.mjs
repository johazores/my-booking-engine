import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('rental availability service is tenant-scoped, authorized, bounded, and block-aware', async () => {
  const service = await source('src/server/inventory/rental-availability-service.ts');
  assert.match(service, /permission: 'inventory:read'/);
  assert.match(service, /organizationId: input\.organizationId,\s*code: search\.unitTypeCode,\s*status: 'ACTIVE'/s);
  assert.match(service, /organizationId: input\.organizationId,\s*code: search\.locationCode,\s*status: 'ACTIVE'/s);
  assert.match(service, /location:\s*\{\s*is:\s*\{\s*organizationId: input\.organizationId,\s*status: 'ACTIVE'/s);
  assert.match(service, /availabilityBlocks:\s*\{\s*none:/s);
  assert.match(service, /organizationId: input\.organizationId,\s*startsOn: \{ lt: search\.endsOn \},\s*endsOn: \{ gt: search\.startsOn \}/s);
  assert.match(service, /rentalRatePeriod\.findMany/);
  assert.match(service, /unitTypeId: unitType\.id,\s*startsOn: \{ lt: search\.endsOn \},\s*endsOn: \{ gt: search\.startsOn \}/s);
  assert.match(service, /skip: \(search\.page - 1\) \* search\.pageSize/);
  assert.match(service, /take: search\.pageSize/);
});

test('rental availability UI is a real protected preview and not booking authority', async () => {
  const page = await source('app/inventory/rentals/availability/page.tsx');
  assert.match(page, /readAuthSessionState/);
  assert.match(page, /readActiveOrganizationContext/);
  assert.match(page, /organizationRoleHasPermission\(authorization\.role, 'inventory:read'\)/);
  assert.match(page, /searchRentalInventoryAvailability/);
  assert.match(page, /method="get" action="\/inventory\/rentals\/availability"/);
  assert.match(page, /does not create a hold or booking/i);
  assert.match(page, /must not be used as customer booking confirmation/i);
  assert.match(page, /Maximum 90 days/);
});

test('rental availability documentation preserves the production boundary', async () => {
  const documentation = await source('docs/rental-inventory.md');
  assert.match(documentation, /internal inventory availability and pricing preview/i);
  assert.match(documentation, /explicit unit availability blocks/i);
  assert.match(documentation, /not a reservation hold, allocation, or customer booking authority/i);
  assert.match(documentation, /must not be used as customer booking confirmation/i);
});
