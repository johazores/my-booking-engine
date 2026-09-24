import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

const integrations = read('src/server/integrations/integration-service.ts');
const amenities = read('src/server/inventory/hospitality-amenity-repository.ts');
const ratePlans = read('src/server/inventory/hospitality-rate-plan-service.ts');
const restrictions = read('src/server/inventory/hospitality-restriction-service.ts');
const rentalMaintenance = read('src/server/inventory/rental-maintenance-service.ts');
const managementDocs = read('docs/management-collection-read-consistency.md');
const integrationDocs = read('docs/integration-collection-pagination.md');
const inventoryDocs = read('docs/inventory-collection-pagination.md');

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing source section: ${start}`);
  const endIndex = end ? source.indexOf(end, startIndex + start.length) : source.length;
  assert.notEqual(endIndex, -1, `Missing source section terminator: ${end}`);
  return source.slice(startIndex, endIndex);
}

function assertSnapshotPage(source, model, orderPattern) {
  assert.match(source, /db\.\$transaction\(async \(transaction\) =>/);
  assert.match(source, new RegExp(`transaction\\.${model}\\.count\\(`));
  assert.match(source, new RegExp(`transaction\\.${model}\\.findMany\\(`));
  assert.match(source, /isolationLevel: 'RepeatableRead'/);
  assert.match(source, orderPattern);
  assert.doesNotMatch(source, new RegExp(`await db\\.${model}\\.count\\(`));
}

test('integration records and current-health evidence share one read snapshot', () => {
  const healthReader = section(integrations, 'async function readIntegrationHealthEvent', 'async function runIntegrationWrite');
  assert.match(healthReader, /client\.auditEvent\.findFirst/);
  assert.doesNotMatch(healthReader, /db\.auditEvent\.findFirst/);

  const exact = section(integrations, 'export async function readIntegrationByProviderCode', 'export async function listIntegrationsPage');
  assert.match(exact, /db\.\$transaction\(async \(transaction\) =>/);
  assert.match(exact, /transaction\.integration\.findUnique/);
  assert.match(exact, /readIntegrationHealthEvent\(transaction/);
  assert.match(exact, /organizationId_providerCode/);
  assert.match(exact, /isolationLevel: 'RepeatableRead'/);

  const page = section(integrations, 'export async function listIntegrationsPage', 'export async function listIntegrations');
  assertSnapshotPage(page, 'integration', /orderBy: \[\{ providerCode: 'asc' \}, \{ id: 'asc' \}\]/);
  assert.match(page, /readIntegrationHealthEvent\(transaction/);
  assert.match(page, /organizationId: input\.organizationId/);
  assert.match(page, /Math\.min\(requestedPage, totalPages\)/);

  const complete = section(integrations, 'export async function listIntegrations(input', 'export async function enableIntegration');
  assert.match(complete, /db\.\$transaction\(async \(transaction\) =>/);
  assert.match(complete, /transaction\.integration\.findMany/);
  assert.match(complete, /readIntegrationHealthEvent\(transaction/);
  assert.match(complete, /take: MAX_COMPLETE_INTEGRATION_ROWS \+ 1/);
  assert.match(complete, /isolationLevel: 'RepeatableRead'/);
});

test('amenity management page uses a tenant-scoped repeatable-read snapshot', () => {
  const source = section(amenities, 'export async function listAmenitiesForOrganizationPage', 'export async function listAmenitiesForOrganization');
  assertSnapshotPage(source, 'hospitalityAmenity', /orderBy: \[\{ status: 'asc' \}, \{ name: 'asc' \}, \{ id: 'asc' \}\]/);
  assert.match(source, /const where = \{ organizationId: input\.organizationId \}/);
  assert.match(source, /resolveInventoryPagination/);
});

test('rate-plan management pages keep counts, parent authority, and rows in one snapshot', () => {
  const directory = section(ratePlans, 'export async function listHospitalityRatePlans', 'export async function readHospitalityRatePlan');
  assertSnapshotPage(directory, 'hospitalityRatePlan', /orderBy: \[\{ status: 'asc' \}, \{ name: 'asc' \}, \{ id: 'asc' \}\]/);
  assert.match(directory, /organizationId: input\.organizationId/);
  assert.match(directory, /propertyId: input\.propertyId/);

  const roomTypes = section(ratePlans, 'export async function listHospitalityRatePlanRoomTypes', 'export async function createHospitalityRatePlan');
  assertSnapshotPage(roomTypes, 'hospitalityRoomType', /orderBy: \[\{ status: 'asc' \}, \{ name: 'asc' \}, \{ id: 'asc' \}\]/);
  assert.match(roomTypes, /transaction\.hospitalityRatePlan\.findFirst/);
  assert.match(roomTypes, /id: input\.ratePlanId/);
  assert.match(roomTypes, /propertyId: input\.propertyId/);
  assert.match(roomTypes, /organizationId: input\.organizationId/);
});

test('restriction management pages keep rate-plan authority and rows in one snapshot', () => {
  const directory = section(restrictions, 'export async function listHospitalityRestrictions', 'export async function listHospitalityRestrictionRoomTypeScopes');
  assertSnapshotPage(directory, 'hospitalityRestriction', /orderBy: \[\{ status: 'asc' \}, \{ startDate: 'asc' \}, \{ endDate: 'asc' \}, \{ id: 'asc' \}\]/);
  assert.match(directory, /transaction\.hospitalityRatePlan\.findFirst/);
  assert.match(directory, /roomTypeId: input\.roomTypeId/);

  const scopes = section(restrictions, 'export async function listHospitalityRestrictionRoomTypeScopes', 'export async function readHospitalityRestrictionRoomTypeScope');
  assertSnapshotPage(scopes, 'hospitalityRoomTypeRatePlan', /orderBy: \[\{ roomType: \{ name: 'asc' \} \}, \{ roomTypeId: 'asc' \}\]/);
  assert.match(scopes, /transaction\.hospitalityRatePlan\.findFirst/);
  assert.match(scopes, /ratePlanId: input\.ratePlanId/);
});

test('rental maintenance clamps page state and observes one active-unit snapshot', () => {
  const source = section(rentalMaintenance, 'export async function readRentalUnitMaintenanceWorkOrders', 'export async function createRentalMaintenanceWorkOrder');
  assert.match(source, /db\.\$transaction\(async \(transaction\) =>/);
  assert.match(source, /transaction\.rentalUnit\.findFirst/);
  assert.equal((source.match(/transaction\.rentalMaintenanceWorkOrder\.count/g) ?? []).length, 2);
  assert.match(source, /transaction\.rentalMaintenanceWorkOrder\.findMany/);
  assert.match(source, /organizationId: input\.organizationId/);
  assert.match(source, /unitId: input\.unitId/);
  assert.match(source, /Math\.min\(requestedPage, totalPages\)/);
  assert.match(source, /orderBy: \[\{ status: 'asc' \}, \{ openedAt: 'desc' \}, \{ id: 'desc' \}\]/);
  assert.match(source, /isolationLevel: 'RepeatableRead'/);
  assert.doesNotMatch(source, /db\.\$transaction\(\[/);
});

test('documentation records snapshot consistency without weakening commercial authority', () => {
  assert.match(managementDocs, /integration control-plane reads/);
  assert.match(managementDocs, /rental maintenance work-order pages/);
  assert.match(managementDocs, /does not convert paginated pages into complete commercial evidence/);
  assert.match(integrationDocs, /one PostgreSQL `RepeatableRead` transaction/);
  assert.match(integrationDocs, /Current-health derivation is snapshot-consistent/);
  assert.match(inventoryDocs, /rental unit maintenance work-order history/);
  assert.match(inventoryDocs, /UI\/list pagination is not a substitute for commercial evidence/);
});
