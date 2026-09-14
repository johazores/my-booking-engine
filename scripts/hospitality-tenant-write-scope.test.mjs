import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function assertNoIdOnlyUpdate(service, modelName, identifier = 'current') {
  const unsafe = new RegExp(`${modelName}\\.update\\(\\{\\s*where: \\{ id: ${identifier}\\.id \\}`);
  assert.doesNotMatch(service, unsafe, `${modelName} update must not be ID-only`);
}

function assertNoIdOnlyDelete(service, modelName) {
  const unsafe = new RegExp(`${modelName}\\.delete\\(\\{\\s*where: \\{ id: current\\.id \\}`);
  assert.doesNotMatch(service, unsafe, `${modelName} delete must not be ID-only`);
}

test('hospitality inventory lifecycle and image writes retain tenant scope', () => {
  const inventory = source('src/server/inventory/hospitality-service.ts');
  const amenities = source('src/server/inventory/hospitality-amenity-service.ts');
  const images = source('src/server/inventory/hospitality-image-service.ts');
  const ratePlans = source('src/server/inventory/hospitality-rate-plan-service.ts');
  const restrictions = source('src/server/inventory/hospitality-restriction-service.ts');
  const assignments = source('src/server/inventory/hospitality-amenity-assignment-service.ts');

  assert.match(inventory, /hospitalityProperty\.update\(\{ where: \{ id: current\.id, organizationId: input\.organizationId \}/);
  assert.match(inventory, /hospitalityRoomType\.update\(\{ where: \{ id: current\.id, organizationId: input\.organizationId \}/);
  assert.match(inventory, /hospitalityRoom\.update\(\{ where: \{ id: current\.id, organizationId: input\.organizationId \}/);
  assert.match(amenities, /hospitalityAmenity\.update\(\{ where: \{ id: current\.id, organizationId: input\.organizationId \}/);
  for (const model of ['hospitalityProperty', 'hospitalityRoomType', 'hospitalityRoom']) assertNoIdOnlyUpdate(inventory, model);
  assertNoIdOnlyUpdate(amenities, 'hospitalityAmenity');

  assert.match(images, /hospitalityRoomTypeImage\.update\(\{\s*where: \{ id: current\.id, organizationId: input\.organizationId, propertyId: input\.propertyId, roomTypeId: input\.roomTypeId \}/);
  assert.match(images, /hospitalityPropertyImage\.update\(\{\s*where: \{ id: current\.id, organizationId: input\.organizationId, propertyId: input\.propertyId \}/);
  assert.match(images, /hospitalityRoomTypeImage\.delete\(\{\s*where: \{ id: current\.id, organizationId: input\.organizationId, propertyId: input\.propertyId, roomTypeId: input\.roomTypeId \}/);
  assert.match(images, /hospitalityPropertyImage\.delete\(\{\s*where: \{ id: current\.id, organizationId: input\.organizationId, propertyId: input\.propertyId \}/);
  assertNoIdOnlyUpdate(images, 'hospitalityRoomTypeImage');
  assertNoIdOnlyUpdate(images, 'hospitalityPropertyImage');
  assertNoIdOnlyDelete(images, 'hospitalityRoomTypeImage');
  assertNoIdOnlyDelete(images, 'hospitalityPropertyImage');

  assert.match(ratePlans, /id_propertyId_organizationId/);
  assert.match(restrictions, /id_propertyId_organizationId/);
  assert.match(assignments, /organizationId_propertyId_amenityId/);
  assert.match(assignments, /organizationId_roomTypeId_amenityId/);
});

test('hospitality pricing archive writes retain tenant and property scope', () => {
  const baseRates = source('src/server/pricing/hospitality-pricing-service.ts');
  const charges = source('src/server/pricing/hospitality-charge-service.ts');
  const addons = source('src/server/pricing/hospitality-addon-service.ts');

  assert.match(baseRates, /hospitalityBaseRate\.update\(\{\s*where: \{ id: current\.id, organizationId: input\.organizationId, propertyId: input\.propertyId \}/);
  assert.match(charges, /hospitalityChargeRule\.update\(\{\s*where: \{ id: current\.id, organizationId: input\.organizationId, propertyId: input\.propertyId \}/);
  assert.match(addons, /hospitalityAddon\.update\(\{\s*where: \{ id: current\.id, organizationId: input\.organizationId, propertyId: input\.propertyId \}/);
  assertNoIdOnlyUpdate(baseRates, 'hospitalityBaseRate');
  assertNoIdOnlyUpdate(charges, 'hospitalityChargeRule');
  assertNoIdOnlyUpdate(addons, 'hospitalityAddon');
});

test('hospitality availability and hold consumption writes retain allocation scope', () => {
  const windows = source('src/server/availability/hospitality-availability-window-service.ts');
  const holds = source('src/server/availability/hospitality-availability-hold-core.ts');
  const confirmation = source('src/server/bookings/hospitality-booking-confirmation-core.ts');

  assert.match(windows, /hospitalityAvailabilityWindow\.update\(\{\s*where: \{ id: current\.id, organizationId: input\.organizationId, propertyId: current\.propertyId, roomTypeId: current\.roomTypeId \}/);
  assert.match(holds, /hospitalityAvailabilityHold\.update\(\{\s*where: \{ id: current\.id, organizationId: input\.organizationId, propertyId: current\.propertyId, roomTypeId: current\.roomTypeId \}/);
  assert.match(confirmation, /hospitalityAvailabilityHold\.update\(\{\s*where: \{ id: hold\.id, organizationId: input\.organizationId, propertyId: hold\.propertyId, roomTypeId: hold\.roomTypeId \}/);
  assertNoIdOnlyUpdate(windows, 'hospitalityAvailabilityWindow');
  assertNoIdOnlyUpdate(holds, 'hospitalityAvailabilityHold');
  assertNoIdOnlyUpdate(confirmation, 'hospitalityAvailabilityHold', 'hold');
});

test('hospitality tenant write-scope documentation records the reviewed boundary', () => {
  const document = source('docs/hospitality-tenant-write-scope.md');

  assert.match(document, /inventory, pricing, availability/i);
  assert.match(document, /final Prisma update or delete predicate/i);
  assert.match(document, /defense in depth/i);
  assert.match(document, /customer, payment\/reconciliation, branding, and organization-management/i);
  assert.match(document, /no GitHub Actions/i);
});
