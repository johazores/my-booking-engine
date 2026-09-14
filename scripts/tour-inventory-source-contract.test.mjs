import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('tour Prisma and migration contracts preserve tenant-safe product relationships and database bounds', async () => {
  const [schema, migration, databaseRunner] = await Promise.all([
    source('prisma/tour-inventory.prisma'),
    source('prisma/migrations/20260914122000_tour_inventory_foundation/migration.sql'),
    source('scripts/run-database-tests.mjs'),
  ]);
  assert.match(schema, /@@unique\(\[id, organizationId\]\)/);
  assert.match(schema, /@relation\(fields: \[tourProductId, organizationId\], references: \[id, organizationId\]/);
  assert.match(schema, /@@unique\(\[tourProductId, startsAt\]\)/);
  assert.match(schema, /@@unique\(\[tourProductId, code\]\)/);
  assert.match(migration, /FOREIGN KEY \("organizationId"\) REFERENCES "organizations"\("id"\)/);
  assert.equal((migration.match(/FOREIGN KEY \("tourProductId", "organizationId"\)/g) ?? []).length, 2);
  assert.match(migration, /"capacity" BETWEEN 1 AND 10000/);
  assert.match(migration, /"endsAt" > "startsAt"/);
  assert.match(migration, /"maxQuantityPerBooking" BETWEEN 1 AND 100/);
  assert.match(databaseRunner, /src\/server\/inventory\/tour-inventory\.integration\.ts/);
});

test('tour service enforces permissions, tenant predicates, audited serializable writes and safe archival dependencies', async () => {
  const service = await source('src/server/inventory/tour-service.ts');
  assert.match(service, /permission: 'inventory:read'/);
  assert.match(service, /permission: 'inventory:manage'/);
  assert.match(service, /organizationId: input\.organizationId/g);
  assert.match(service, /tourProductId: input\.tourProductId/);
  assert.match(service, /isolationLevel: 'Serializable'/);
  assert.match(service, /inventory\.tour-product\.created/);
  assert.match(service, /inventory\.tour-departure\.created/);
  assert.match(service, /inventory\.tour-addon\.created/);
  assert.match(service, /Archive active departures and add-ons before archiving the tour or package/);
  assert.doesNotMatch(service, /delete\(|deleteMany\(/);
});

test('tour HTTP and UI surfaces use authenticated persistence, expose real states, and avoid fake pricing or booking actions', async () => {
  const [createRoute, departureRoute, addonRoute, archiveRoute, departureArchiveRoute, addonArchiveRoute, listPage, detailPage, loadingPage, errorPage, inventoryPage, inventoryHttp] = await Promise.all([
    source('app/api/inventory/tours/route.ts'),
    source('app/api/inventory/tours/[tour-id]/departures/route.ts'),
    source('app/api/inventory/tours/[tour-id]/addons/route.ts'),
    source('app/api/inventory/tours/[tour-id]/archive/route.ts'),
    source('app/api/inventory/tours/[tour-id]/departures/[departure-id]/archive/route.ts'),
    source('app/api/inventory/tours/[tour-id]/addons/[addon-id]/archive/route.ts'),
    source('app/inventory/tours/page.tsx'),
    source('app/inventory/tours/[tour-id]/page.tsx'),
    source('app/inventory/tours/loading.tsx'),
    source('app/inventory/tours/error.tsx'),
    source('app/inventory/page.tsx'),
    source('src/server/inventory/inventory-http.ts'),
  ]);
  for (const route of [createRoute, departureRoute, addonRoute, archiveRoute, departureArchiveRoute, addonArchiveRoute]) {
    assert.match(route, /prepareInventoryMutationRequest/);
    assert.match(route, /inventoryErrorCode/);
  }
  assert.match(listPage, /listTourProducts/);
  assert.match(listPage, /action="\/api\/inventory\/tours"/);
  assert.match(detailPage, /readTourProduct/);
  assert.match(detailPage, /\/departures`}/);
  assert.match(detailPage, /\/addons`}/);
  assert.match(detailPage, /Pricing stays behind the pricing layer/);
  assert.match(loadingPage, /aria-busy="true"/);
  assert.match(errorPage, /onClick=\{reset\}/);
  assert.match(inventoryPage, /href="\/inventory\/tours"/);
  assert.match(inventoryHttp, /TourInventoryValidationError/);
  assert.match(inventoryHttp, /TourInventoryConflictError/);
  assert.match(inventoryHttp, /TourInventoryDependencyError/);
  assert.match(inventoryHttp, /TourInventoryUnavailableError/);
  assert.doesNotMatch(`${listPage}\n${detailPage}`, /mock|placeholder route|fake analytics/i);
  assert.doesNotMatch(`${listPage}\n${detailPage}`, /book now|reserve now|price per person/i);
});
