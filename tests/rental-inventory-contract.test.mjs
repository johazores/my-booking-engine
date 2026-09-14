import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('rental schema binds location and child relations to organization ownership', async () => {
  const schema = await source('prisma/rental-inventory.prisma');
  assert.match(schema, /model RentalLocation \{/);
  assert.match(schema, /@@unique\(\[id, organizationId\]\)/);
  assert.match(schema, /@@unique\(\[organizationId, code\]\)/);
  assert.match(schema, /location\s+RentalLocation\?\s+@relation\(fields: \[locationId, organizationId\], references: \[id, organizationId\]/);
  assert.match(schema, /@relation\(fields: \[unitTypeId, organizationId\], references: \[id, organizationId\]/);
  assert.match(schema, /@relation\(fields: \[unitId, organizationId\], references: \[id, organizationId\]/);
});

test('rental service enforces authorization, tenant-scoped location authority, overlap checks, and lifecycle dependencies', async () => {
  const service = await source('src/server/inventory/rental-service.ts');
  assert.match(service, /permission: 'inventory:read' \| 'inventory:manage'/);
  assert.match(service, /organizationId: input\.organizationId, code: unit\.locationCode, status: 'ACTIVE'/);
  assert.match(service, /organizationId: input\.organizationId, code: locationCode, status: 'ACTIVE'/);
  assert.match(service, /locationId: current\.id, status: 'ACTIVE'/);
  assert.match(service, /Move or archive active rental units before archiving this location/);
  assert.match(service, /startsOn: \{ lt: block\.endsOn \}/);
  assert.match(service, /endsOn: \{ gt: block\.startsOn \}/);
  assert.match(service, /startsOn: \{ lt: rate\.endsOn \}/);
  assert.match(service, /endsOn: \{ gt: rate\.startsOn \}/);
});

test('rental location routes and UI use real tenant-protected mutations', async () => {
  const createRoute = await source('app/api/inventory/rentals/locations/route.ts');
  const archiveRoute = await source('app/api/inventory/rentals/locations/[location-id]/archive/route.ts');
  const moveRoute = await source('app/api/inventory/rentals/units/[unit-id]/location/route.ts');
  const unitRoute = await source('app/api/inventory/rentals/units/route.ts');
  const rentalPage = await source('app/inventory/rentals/page.tsx');
  const locationPage = await source('app/inventory/rentals/locations/[location-id]/page.tsx');
  const unitTypePage = await source('app/inventory/rentals/types/[unit-type-id]/page.tsx');
  const unitPage = await source('app/inventory/rentals/units/[unit-id]/page.tsx');
  assert.match(createRoute, /prepareInventoryMutationRequest\(request, 'inventory\.rental-location\.create'\)/);
  assert.match(archiveRoute, /archiveRentalLocation/);
  assert.match(moveRoute, /assignRentalUnitLocation/);
  assert.match(unitRoute, /locationCode: formField\(formData, 'locationCode'\)/);
  assert.match(rentalPage, /locationPage/);
  assert.match(locationPage, /name="confirmation" required/);
  assert.match(locationPage, />Archive location</);
  assert.match(unitTypePage, /Type REMOVE to confirm/);
  assert.match(unitPage, /Type REMOVE to confirm/);
  assert.doesNotMatch(unitTypePage, /type="hidden" name="confirmation" value="REMOVE"/);
  assert.doesNotMatch(unitPage, /type="hidden" name="confirmation" value="REMOVE"/);
});

test('rental documentation distinguishes inventory locations from customer pickup and booking workflows', async () => {
  const documentation = await source('docs/rental-inventory.md');
  assert.match(documentation, /does \*\*not\*\* make a location a customer-selected pickup or drop-off promise/i);
  assert.match(documentation, /payment processing/);
  assert.match(documentation, /customer-facing rental search or checkout/);
  assert.match(documentation, /customer pickup\/drop-off selection/);
});

test('rental PostgreSQL scenario is guarded and wired into the disposable database harness', async () => {
  const integration = await source('src/server/inventory/rental-inventory.integration.ts');
  const harness = await source('scripts/run-database-tests.mjs');
  assert.match(integration, /TEST_DATABASE_URL/);
  assert.match(integration, /databaseUrl !== testDatabaseUrl/);
  assert.match(integration, /RENTAL_BUSINESS/);
  assert.match(integration, /organizationId: organizationA\.id/);
  assert.match(integration, /organizationId: organizationB\.id/);
  assert.match(harness, /src\/server\/inventory\/rental-inventory\.integration\.ts/);
});
