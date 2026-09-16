import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('maintenance schema retains tenant ownership, idempotency, and forward lifecycle evidence', async () => {
  const schema = await source('prisma/rental-maintenance.prisma');
  const rentalSchema = await source('prisma/rental-inventory.prisma');
  assert.match(schema, /enum RentalMaintenanceWorkOrderStatus/);
  assert.match(schema, /@@unique\(\[organizationId, idempotencyKey\]/);
  assert.match(schema, /@relation\(fields: \[unitId, organizationId\], references: \[id, organizationId\]/);
  assert.match(schema, /completionNotes\s+String\?/);
  assert.match(schema, /cancellationReason\s+String\?/);
  assert.match(rentalSchema, /maintenanceWorkOrders\s+RentalMaintenanceWorkOrder\[\]/);
});

test('maintenance service is permissioned, tenant-scoped, serialized, idempotent, audited, and operationally coupled', async () => {
  const service = await source('src/server/inventory/rental-maintenance-service.ts');
  assert.match(service, /requireOrganizationPermission/);
  assert.match(service, /permission: 'inventory:read' \| 'inventory:manage'/);
  assert.match(service, /organizationId: input\.organizationId/);
  assert.match(service, /maintenanceIdempotencyLockKey/);
  assert.match(service, /rentalUnitLockKey/);
  assert.match(service, /setLockedRentalUnitOperationalStatusInTransaction/);
  assert.match(service, /inventory\.rental-maintenance\.work-order-opened/);
  assert.match(service, /inventory\.rental-maintenance\.work-order-status-changed/);
  assert.match(service, /activeTotal/);
  assert.match(service, /orderBy: \[\{ status: 'asc' \}/);
  assert.match(service, /take: pageSize/);
});

test('database migration authors lifecycle time and prevents unsafe release or evidence rewrites', async () => {
  const migration = await source('prisma/migrations/20260916223000_rental_maintenance_work_orders/migration.sql');
  assert.match(migration, /clock_timestamp\(\)/);
  assert.match(migration, /rental maintenance work orders cannot be deleted/);
  assert.match(migration, /rental maintenance source evidence is immutable/);
  assert.match(migration, /terminal rental maintenance work orders are immutable/);
  assert.match(migration, /requires the unit to be out of service/);
  assert.match(migration, /status" IN \('OPEN', 'IN_PROGRESS'\)/);
  assert.match(migration, /rental unit has active maintenance work/);
  assert.match(migration, /cannot be archived/);
});

test('operational status refuses availability while active maintenance remains', async () => {
  const operational = await source('src/server/inventory/rental-unit-operational-service.ts');
  assert.match(operational, /rentalMaintenanceWorkOrder\.count/);
  assert.match(operational, /status: \{ in: \['OPEN', 'IN_PROGRESS'\] \}/);
  assert.match(operational, /Complete or cancel active maintenance work before returning this rental unit to service/);
});

test('staff maintenance surface exposes real lifecycle actions without fake automation', async () => {
  const page = await source('app/inventory/rentals/units/[unit-id]/maintenance/page.tsx');
  const createRoute = await source('app/api/inventory/rentals/units/[unit-id]/maintenance/route.ts');
  const transitionRoute = await source('app/api/inventory/rentals/units/[unit-id]/maintenance/[work-order-id]/transition/route.ts');
  const docs = await source('docs/rental-maintenance-work-orders.md');
  assert.match(page, /Open work order/);
  assert.match(page, /Start work/);
  assert.match(page, /Complete work/);
  assert.match(page, /Cancel work order/);
  assert.match(createRoute, /createRentalMaintenanceWorkOrder/);
  assert.match(transitionRoute, /transitionRentalMaintenanceWorkOrder/);
  assert.match(docs, /does \*\*not\*\* automatically return the unit to service/);
  assert.match(docs, /does not automatically cancel, refund, reschedule, extend, or substitute/);
});
