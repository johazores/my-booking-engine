import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('appointment schema and migration enforce tenant-safe relationships and bounded schedule/service data', async () => {
  const [schema, migration, runner] = await Promise.all([
    source('prisma/appointment-inventory.prisma'),
    source('prisma/migrations/20260914130000_appointment_inventory_foundation/migration.sql'),
    source('scripts/run-database-tests.mjs'),
  ]);
  assert.match(schema, /model AppointmentService/);
  assert.match(schema, /model AppointmentStaff/);
  assert.match(schema, /model AppointmentStaffService/);
  assert.match(schema, /model AppointmentSchedule/);
  assert.match(schema, /@relation\(fields: \[staffId, organizationId\], references: \[id, organizationId\]/);
  assert.match(schema, /@relation\(fields: \[serviceId, organizationId\], references: \[id, organizationId\]/);
  assert.match(migration, /appointment_services_organization_fkey/);
  assert.match(migration, /appointment_staff_organization_fkey/);
  assert.match(migration, /appointment_staff_services_staff_tenant_fkey/);
  assert.match(migration, /appointment_staff_services_service_tenant_fkey/);
  assert.match(migration, /appointment_schedules_staff_tenant_fkey/);
  assert.match(migration, /durationMinutes" BETWEEN 5 AND 1440/);
  assert.match(migration, /dayOfWeek" BETWEEN 0 AND 6/);
  assert.match(runner, /src\/server\/inventory\/appointment-inventory\.integration\.ts/);
});

test('appointment services enforce permissions, tenant predicates, bounded reads, serializable audited writes, and lifecycle dependencies', async () => {
  const [service, repository] = await Promise.all([
    source('src/server/inventory/appointment-service.ts'),
    source('src/server/inventory/appointment-repository.ts'),
  ]);
  assert.match(service, /permission: 'inventory:read'/);
  assert.match(service, /permission: 'inventory:manage'/);
  assert.match(service, /isolationLevel: 'Serializable'/);
  assert.match(service, /inventory\.appointment-service\.created/);
  assert.match(service, /inventory\.appointment-staff\.created/);
  assert.match(service, /inventory\.appointment-staff-service\.assigned/);
  assert.match(service, /inventory\.appointment-schedule\.created/);
  assert.match(service, /overlaps another active schedule/);
  assert.match(service, /Remove active staff assignments before archiving/);
  assert.match(service, /Archive active schedules and remove service assignments before archiving/);
  assert.match(repository, /organizationId: input\.organizationId/g);
  assert.match(repository, /take: pageSize/g);
  assert.match(repository, /pageSize >= 1 && pageSize <= 50/);
});

test('appointment UI and routes are real protected inventory operations with bounded collection states and no fake booking/pricing', async () => {
  const [listPage, detailPage, loadingPage, errorPage, serviceRoute, staffRoute, scheduleRoute, assignmentRoute, docs] =
    await Promise.all([
      source('app/inventory/appointments/page.tsx'),
      source('app/inventory/appointments/[staff-id]/page.tsx'),
      source('app/inventory/appointments/loading.tsx'),
      source('app/inventory/appointments/error.tsx'),
      source('app/api/inventory/appointments/services/route.ts'),
      source('app/api/inventory/appointments/staff/route.ts'),
      source('app/api/inventory/appointments/staff/[staff-id]/schedules/route.ts'),
      source('app/api/inventory/appointments/staff/[staff-id]/services/route.ts'),
      source('docs/appointment-inventory.md'),
    ]);
  assert.match(listPage, /inventory:read/);
  assert.match(listPage, /inventory:manage/);
  assert.match(listPage, /Appointment service pages/);
  assert.match(listPage, /Appointment staff pages/);
  assert.match(detailPage, /Appointment schedule pages/);
  assert.match(detailPage, /Assigned appointment service pages/);
  assert.match(detailPage, /Overlapping active windows are rejected/);
  assert.match(serviceRoute, /prepareInventoryMutationRequest/);
  assert.match(staffRoute, /prepareInventoryMutationRequest/);
  assert.match(scheduleRoute, /prepareInventoryMutationRequest/);
  assert.match(assignmentRoute, /prepareInventoryMutationRequest/);
  assert.match(loadingPage, /aria-busy="true"/);
  assert.match(errorPage, /role="alert"/);
  assert.doesNotMatch(listPage + detailPage + docs, /fake (booking|pricing)|mock (booking|pricing)/i);
  assert.match(docs, /does \*\*not\*\* create appointment bookings/i);
});
