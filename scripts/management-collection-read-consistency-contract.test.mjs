import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

const organizations = read('src/server/organizations/organization-repository.ts');
const memberships = read('src/server/memberships/membership-repository.ts');
const customers = read('src/server/customers/customer-repository.ts');
const hospitality = read('src/server/inventory/hospitality-repository.ts');
const tours = read('src/server/inventory/tour-repository.ts');
const appointments = read('src/server/inventory/appointment-repository.ts');
const availability = read('src/server/availability/hospitality-availability-window-service.ts');
const docs = read('docs/management-collection-read-consistency.md');

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing source section: ${start}`);
  const endIndex = end ? source.indexOf(end, startIndex + start.length) : source.length;
  assert.notEqual(endIndex, -1, `Missing source section terminator: ${end}`);
  return source.slice(startIndex, endIndex);
}

function assertSnapshotRead(source, model, orderPattern) {
  assert.match(source, /db\.\$transaction\(async \(transaction\) =>/);
  assert.match(source, new RegExp(`transaction\\.${model}\\.count\\(`));
  assert.match(source, new RegExp(`transaction\\.${model}\\.findMany\\(`));
  assert.match(source, /isolationLevel: 'RepeatableRead'/);
  assert.match(source, orderPattern);
  assert.doesNotMatch(source, new RegExp(`await db\\.${model}\\.count\\(`));
}

test('tenant access pages and membership aggregates use stable snapshots', () => {
  const organizationPage = section(
    organizations,
    'export async function listOrganizationsForUserPage',
    'export function findOrganizationForUser',
  );
  assertSnapshotRead(organizationPage, 'organization', /orderBy: \[\{ name: 'asc' \}, \{ id: 'asc' \}\]/);
  assert.match(organizationPage, /activeOrganizationMembershipScope\(input\.userId\)/);

  const membershipPage = section(
    memberships,
    'export async function listMembershipsForOrganizationPage',
    'export async function readOrganizationMembershipStats',
  );
  assertSnapshotRead(membershipPage, 'organizationMembership', /orderBy: \[\{ createdAt: 'asc' \}, \{ id: 'asc' \}\]/);
  assert.match(membershipPage, /activeTenantOwnedCollectionScope\(input\)/);

  const stats = section(
    memberships,
    'export async function readOrganizationMembershipStats',
    'export function findMembershipForOrganization',
  );
  assert.match(stats, /db\.\$transaction\(async \(transaction\) =>/);
  assert.equal((stats.match(/transaction\.organizationMembership\.count/g) ?? []).length, 2);
  assert.match(stats, /status: 'ACTIVE'/);
  assert.match(stats, /isolationLevel: 'RepeatableRead'/);
});

test('customer directory count and rows share one tenant-scoped snapshot', () => {
  const source = section(customers, 'export async function listCustomersForOrganization', 'export async function readCustomerForOrganization');
  assertSnapshotRead(source, 'customer', /orderBy: customerOrderBy\(input\.sort\)/);
  assert.match(source, /organizationId: input\.organizationId/);
  assert.match(source, /Math\.min\(pagination\.page, totalPages\)/);
});

test('hospitality inventory pages use snapshot-consistent count and rows', () => {
  const properties = section(hospitality, 'export async function listHospitalityPropertiesForOrganization', 'export async function readPropertyForOrganization');
  assertSnapshotRead(properties, 'hospitalityProperty', /orderBy: \[\{ status: 'asc' \}, \{ name: 'asc' \}, \{ id: 'asc' \}\]/);
  assert.match(properties, /organizationId: input\.organizationId/);

  const roomTypes = section(hospitality, 'export async function listRoomTypesForProperty', 'export async function readRoomTypeForOrganization');
  assertSnapshotRead(roomTypes, 'hospitalityRoomType', /orderBy: \[\{ status: 'asc' \}, \{ name: 'asc' \}, \{ id: 'asc' \}\]/);
  assert.match(roomTypes, /propertyId: input\.propertyId/);

  const rooms = section(hospitality, 'export async function listRoomsForRoomType', null);
  assertSnapshotRead(rooms, 'hospitalityRoom', /orderBy: \[\{ status: 'asc' \}, \{ code: 'asc' \}, \{ id: 'asc' \}\]/);
  assert.match(rooms, /propertyId: input\.propertyId/);
  assert.match(rooms, /roomTypeId: input\.roomTypeId/);
});

test('tour inventory pages use snapshot-consistent count and rows', () => {
  const products = section(tours, 'export async function listTourProductsForOrganization', 'export async function readTourProductForOrganization');
  assertSnapshotRead(products, 'tourProduct', /orderBy: \[\{ status: 'asc' \}, \{ name: 'asc' \}, \{ id: 'asc' \}\]/);

  const departures = section(tours, 'export async function listTourDeparturesForProduct', 'export async function listTourAddonsForProduct');
  assertSnapshotRead(departures, 'tourDeparture', /orderBy: \[\{ status: 'asc' \}, \{ startsAt: 'asc' \}, \{ id: 'asc' \}\]/);
  assert.match(departures, /tourProductId: input\.tourProductId/);

  const addons = section(tours, 'export async function listTourAddonsForProduct', null);
  assertSnapshotRead(addons, 'tourAddon', /orderBy: \[\{ status: 'asc' \}, \{ name: 'asc' \}, \{ id: 'asc' \}\]/);
  assert.match(addons, /tourProductId: input\.tourProductId/);
});

test('appointment inventory pages use snapshot-consistent count and rows', () => {
  const services = section(appointments, 'export async function listAppointmentServicesForOrganization', 'export async function listAppointmentStaffForOrganization');
  assertSnapshotRead(services, 'appointmentService', /orderBy: \[\{ status: 'asc' \}, \{ name: 'asc' \}, \{ id: 'asc' \}\]/);

  const staff = section(appointments, 'export async function listAppointmentStaffForOrganization', 'export async function readAppointmentStaffForOrganization');
  assertSnapshotRead(staff, 'appointmentStaff', /orderBy: \[\{ status: 'asc' \}, \{ name: 'asc' \}, \{ id: 'asc' \}\]/);

  const schedules = section(appointments, 'export async function listAppointmentSchedulesForStaff', 'export async function listAppointmentServiceAssignmentsForStaff');
  assertSnapshotRead(schedules, 'appointmentSchedule', /orderBy: \[\{ status: 'asc' \}, \{ dayOfWeek: 'asc' \}, \{ startsAtMinute: 'asc' \}, \{ id: 'asc' \}\]/);
  assert.match(schedules, /staffId: input\.staffId/);

  const assignments = section(appointments, 'export async function listAppointmentServiceAssignmentsForStaff', null);
  assertSnapshotRead(assignments, 'appointmentStaffService', /orderBy: \[\{ service: \{ name: 'asc' \} \}, \{ serviceId: 'asc' \}\]/);
  assert.match(assignments, /staffId: input\.staffId/);
});

test('availability-window management page uses one room-type snapshot', () => {
  const source = section(availability, 'export async function listHospitalityAvailabilityWindowsPage', 'export async function listHospitalityAvailabilityWindows');
  assertSnapshotRead(source, 'hospitalityAvailabilityWindow', /orderBy: \[\{ status: 'asc' \}, \{ startDate: 'asc' \}, \{ id: 'asc' \}\]/);
  assert.match(source, /availabilityWindowScope\(input\)/);
  assert.match(source, /Math\.min\(requestedPage, totalPages\)/);
});

test('documentation separates read-model snapshots from commercial completeness', () => {
  assert.match(docs, /RepeatableRead/);
  assert.match(docs, /tenant isolation/);
  assert.match(docs, /presentation\/read-model collections/);
  assert.match(docs, /does not convert paginated pages into complete commercial evidence/);
});
