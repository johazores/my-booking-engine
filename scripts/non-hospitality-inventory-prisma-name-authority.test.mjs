import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

const byteLength = (value) => Buffer.byteLength(value, 'utf8');

test('appointment Prisma physical names match the checked-in inventory migration', async () => {
  const [schema, migration] = await Promise.all([
    source('prisma/appointment-inventory.prisma'),
    source('prisma/migrations/20260914130000_appointment_inventory_foundation/migration.sql'),
  ]);

  const mappedNames = [
    'appointment_services_id_org_key',
    'appointment_services_org_code_key',
    'appointment_services_org_status_name_idx',
    'appointment_staff_id_org_key',
    'appointment_staff_org_code_key',
    'appointment_staff_org_status_name_idx',
    'appointment_staff_services_staff_tenant_fkey',
    'appointment_staff_services_service_tenant_fkey',
    'appointment_staff_services_org_service_idx',
    'appointment_schedules_staff_tenant_fkey',
    'appointment_schedules_id_org_key',
    'appointment_schedules_staff_window_key',
    'appointment_schedules_org_staff_status_day_idx',
  ];

  for (const name of mappedNames) {
    assert.match(schema, new RegExp(`map: "${name}"`), `${name} must be explicit Prisma authority`);
    assert.match(migration, new RegExp(`"${name}"`), `${name} must exist in the checked-in migration`);
    assert.ok(byteLength(name) <= 63, `${name} must fit PostgreSQL's identifier limit`);
  }
});

test('tour Prisma physical names match compact checked-in migration authority', async () => {
  const [schema, migration] = await Promise.all([
    source('prisma/tour-inventory.prisma'),
    source('prisma/migrations/20260914122000_tour_inventory_foundation/migration.sql'),
  ]);

  const mappedNames = [
    'tour_products_org_status_name_idx',
    'tour_departures_product_tenant_fkey',
    'tour_departures_org_product_status_start_idx',
    'tour_addons_product_tenant_fkey',
    'tour_addons_org_product_status_name_idx',
  ];

  for (const name of mappedNames) {
    assert.match(schema, new RegExp(`map: "${name}"`), `${name} must be explicit Prisma authority`);
    assert.match(migration, new RegExp(`"${name}"`), `${name} must exist in the checked-in migration`);
    assert.ok(byteLength(name) <= 63, `${name} must fit PostgreSQL's identifier limit`);
  }
});

test('inventory mappings remove implicit PostgreSQL-truncated Prisma names', () => {
  const implicitOverlongNames = [
    'appointment_schedules_staffId_dayOfWeek_startsAtMinute_endsAtMinute_key',
    'appointment_schedules_organizationId_staffId_status_dayOfWeek_startsAtMinute_idx',
    'tour_departures_organizationId_tourProductId_status_startsAt_idx',
  ];

  assert.deepEqual(
    implicitOverlongNames.map(byteLength),
    [71, 80, 64],
    'the regression must continue to cover the exact overlong implicit names that motivated explicit mappings',
  );
});

test('appointment and tour child relations keep composite tenant authority', async () => {
  const [appointmentSchema, tourSchema] = await Promise.all([
    source('prisma/appointment-inventory.prisma'),
    source('prisma/tour-inventory.prisma'),
  ]);

  assert.match(
    appointmentSchema,
    /staff\s+AppointmentStaff\s+@relation\(fields: \[staffId, organizationId\], references: \[id, organizationId\][^)]*map: "appointment_staff_services_staff_tenant_fkey"\)/,
  );
  assert.match(
    appointmentSchema,
    /service\s+AppointmentService\s+@relation\(fields: \[serviceId, organizationId\], references: \[id, organizationId\][^)]*map: "appointment_staff_services_service_tenant_fkey"\)/,
  );
  assert.match(
    appointmentSchema,
    /staff\s+AppointmentStaff\s+@relation\(fields: \[staffId, organizationId\], references: \[id, organizationId\][^)]*map: "appointment_schedules_staff_tenant_fkey"\)/,
  );
  assert.equal(
    (tourSchema.match(/@relation\(fields: \[tourProductId, organizationId\], references: \[id, organizationId\][^)]*map: "tour_(?:departures|addons)_product_tenant_fkey"\)/g) ?? []).length,
    2,
  );
});
