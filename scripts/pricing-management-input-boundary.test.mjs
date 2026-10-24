import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const creates = [
  ['src/server/pricing/hospitality-pricing-service.ts', 'baseRate', ['propertyId', 'roomTypeId', 'ratePlanId']],
  ['src/server/pricing/hospitality-charge-service.ts', 'rule', ['propertyId']],
  ['src/server/pricing/hospitality-addon-service.ts', 'addon', ['propertyId']],
];
const routes = [
  'app/api/pricing/base-rates/route.ts',
  'app/api/pricing/base-rates/[base-rate-id]/archive/route.ts',
  'app/api/pricing/charges/route.ts',
  'app/api/pricing/charges/[charge-rule-id]/archive/route.ts',
  'app/api/pricing/addons/route.ts',
  'app/api/pricing/addons/[addon-id]/archive/route.ts',
];

test('pricing create services authorize before reading nested scope identifiers', () => {
  for (const [path, field, identifiers] of creates) {
    const source = readFileSync(path, 'utf8');
    const start = source.indexOf('export async function createHospitality');
    const permission = source.indexOf("permission: 'pricing:manage'", start);
    const firstScope = source.indexOf(`requirePricingObjectText(input.${field},`, permission);
    const transaction = source.indexOf('db.$transaction(', permission);
    assert.ok(start >= 0 && permission > start && firstScope > permission && transaction > firstScope, path);
    for (const id of identifiers) {
      assert.ok(source.includes(`requirePricingObjectText(input.${field}, '${id}',`), `${path} must validate ${id}`);
    }
  }
});

test('all pricing form routes use UUID-safe error destinations', () => {
  const http = readFileSync('src/server/pricing/pricing-http.ts', 'utf8');
  assert.match(http, /error instanceof TenantIdentifierValidationError/);
  assert.match(http, /assertUuidIdentifier\(propertyId\.trim\(\), 'propertyId'\)/);
  for (const path of routes) {
    const source = readFileSync(path, 'utf8');
    assert.match(source, /const target = pricingErrorTarget\(propertyId/);
    assert.match(source, /const code = pricingErrorCode\(error\)/);
    assert.doesNotMatch(source, /const target = propertyId \?/);
  }
});
