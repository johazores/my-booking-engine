import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const INVENTORY_ROUTES = [
  ['app/api/inventory/amenities/route.ts', 'inventory.amenity.create'],
  ['app/api/inventory/amenities/[amenity-id]/archive/route.ts', 'inventory.amenity.archive'],
  ['app/api/inventory/amenity-property-assignments/route.ts', 'inventory.property-amenity.mutate'],
  ['app/api/inventory/amenity-room-type-assignments/route.ts', 'inventory.room-type-amenity.mutate'],
  ['app/api/inventory/images/route.ts', 'inventory.image.mutate'],
  ['app/api/inventory/properties/route.ts', 'inventory.property.create'],
  ['app/api/inventory/properties/[property-id]/archive/route.ts', 'inventory.property.archive'],
  ['app/api/inventory/rate-plans/route.ts', 'inventory.rate-plan.create'],
  ['app/api/inventory/rate-plans/[rate-plan-id]/archive/route.ts', 'inventory.rate-plan.archive'],
  ['app/api/inventory/rate-plan-room-types/route.ts', 'inventory.rate-plan-room-type.mutate'],
  ['app/api/inventory/restrictions/route.ts', 'inventory.restriction.create'],
  ['app/api/inventory/restrictions/[restriction-id]/archive/route.ts', 'inventory.restriction.archive'],
  ['app/api/inventory/room-types/route.ts', 'inventory.room-type.create'],
  ['app/api/inventory/room-types/[room-type-id]/archive/route.ts', 'inventory.room-type.archive'],
  ['app/api/inventory/rooms/route.ts', 'inventory.room.create'],
  ['app/api/inventory/rooms/[room-id]/archive/route.ts', 'inventory.room.archive'],
];

function source(path) {
  return readFileSync(path, 'utf8');
}

test('all inventory mutation routes use the shared observed tenant boundary', () => {
  for (const [path, operation] of INVENTORY_ROUTES) {
    const routeSource = source(path);
    assert.ok(routeSource.includes(`'${operation}'`), `${path} must use ${operation}`);
    assert.ok(routeSource.includes('prepareInventoryMutationRequest(request,'), `${path} must use the shared request boundary`);
    assert.ok(routeSource.includes('if (!mutation.ok) return mutation.response;'), `${path} must fail through the observed boundary`);
    assert.doesNotMatch(routeSource, /readAuthSession|readActiveOrganizationContext/);
  }
});

test('the inventory request boundary attaches organization scope only after tenant authority succeeds', () => {
  const helper = source('src/server/inventory/inventory-http.ts');
  const tenantReadIndex = helper.indexOf('await readActiveOrganizationContext(session.user.id)');
  const noTenantIndex = helper.indexOf('if (!activeContext.organization)');
  const scopeIndex = helper.indexOf('organizationId = activeContext.organization.id;');
  assert.ok(tenantReadIndex >= 0 && noTenantIndex > tenantReadIndex && scopeIndex > noTenantIndex);
  assert.match(helper, /catch \{\n    return \{ ok: false as const, response: finish\(new Response\('Internal Server Error', \{ status: 500 \}\)\) \};\n  \}/);
});

test('inventory route log scope is organization-only and does not promote inventory or form data', () => {
  const helper = source('src/server/inventory/inventory-http.ts');
  const finishDefinition = helper.match(/const finish = [\s\S]*?;\n\n/);
  assert.ok(finishDefinition);
  assert.match(finishDefinition[0], /\{ organizationId \}/);
  const forbidden = [
    'propertyId',
    'roomTypeId',
    'ratePlanId',
    'amenityId',
    'restrictionId',
    'imageId',
    'formData',
    'request.url',
  ];
  for (const field of forbidden) assert.equal(finishDefinition[0].includes(field), false, `must not log ${field}`);
});

test('malformed inventory forms are explicit validation rejections', () => {
  for (const [path] of INVENTORY_ROUTES) {
    const routeSource = source(path);
    assert.ok(routeSource.includes('readInventoryFormData(request)'), `${path} must use safe form parsing`);
    assert.ok(routeSource.includes('error=validation'), `${path} must redirect malformed forms as validation`);
    assert.ok(routeSource.includes("'rejected'"), `${path} must classify validation redirect as rejected`);
  }
});

test('inventory service failures preserve rejected-versus-failed redirect outcomes', () => {
  for (const [path] of INVENTORY_ROUTES) {
    const routeSource = source(path);
    assert.match(routeSource, /code === 'server' \? 'failed' : 'rejected'/);
  }
});

test('multi-action inventory routes reject unknown action values instead of defaulting to a write', () => {
  const routes = [
    'app/api/inventory/amenity-property-assignments/route.ts',
    'app/api/inventory/amenity-room-type-assignments/route.ts',
    'app/api/inventory/images/route.ts',
    'app/api/inventory/rate-plan-room-types/route.ts',
  ];
  for (const path of routes) {
    const routeSource = source(path);
    assert.match(routeSource, /return finish\(new Response\('Bad Request', \{ status: 400 \}\)\)/);
  }
});
