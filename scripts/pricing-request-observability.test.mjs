import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const PRICING_ROUTES = [
  ['app/api/pricing/addons/route.ts', 'pricing.addon.create'],
  ['app/api/pricing/addons/[addon-id]/archive/route.ts', 'pricing.addon.archive'],
  ['app/api/pricing/base-rates/route.ts', 'pricing.base-rate.create'],
  ['app/api/pricing/base-rates/[base-rate-id]/archive/route.ts', 'pricing.base-rate.archive'],
  ['app/api/pricing/charges/route.ts', 'pricing.charge.create'],
  ['app/api/pricing/charges/[charge-rule-id]/archive/route.ts', 'pricing.charge.archive'],
];

function source(path) {
  return readFileSync(path, 'utf8');
}

test('pricing management mutations emit correlated completion records with organization-only scope', () => {
  for (const [path, operation] of PRICING_ROUTES) {
    const routeSource = source(path);
    assert.ok(routeSource.includes(`operation: '${operation}'`), `${path} must use ${operation}`);
    assert.match(routeSource, /createRequestObservation\(request, \{ operation: '[^']+' \}\)/);
    assert.match(routeSource, /observation\.finish\(/);
    assert.match(routeSource, /\{ organizationId \}/);
  }
});

test('pricing tenant scope is attached only after active-organization authority is established', () => {
  for (const [path] of PRICING_ROUTES) {
    const routeSource = source(path);
    const authorityIndex = routeSource.indexOf('await readActiveOrganizationContext(session.user.id)');
    const scopeIndex = routeSource.indexOf('organizationId = activeContext.organization.id;');
    assert.ok(authorityIndex >= 0 && scopeIndex > authorityIndex, `${path} must establish tenant authority before log scope`);
  }
});

test('pricing auth and tenant infrastructure failures are observed as HTTP 500', () => {
  for (const [path] of PRICING_ROUTES) {
    const routeSource = source(path);
    const sessionIndex = routeSource.indexOf('await readAuthSession();');
    const tenantIndex = routeSource.indexOf('await readActiveOrganizationContext(session.user.id)');
    const sessionFailureIndex = routeSource.indexOf("new Response('Internal Server Error', { status: 500 })", sessionIndex);
    const tenantFailureIndex = routeSource.indexOf("new Response('Internal Server Error', { status: 500 })", tenantIndex);
    assert.ok(sessionIndex >= 0 && sessionFailureIndex > sessionIndex, `${path} must observe session-read failures`);
    assert.ok(tenantIndex > sessionFailureIndex && tenantFailureIndex > tenantIndex, `${path} must observe tenant lookup failures`);
  }
});

test('pricing redirects classify expected failures separately from server failures', () => {
  for (const [path] of PRICING_ROUTES) {
    const routeSource = source(path);
    assert.ok(routeSource.includes("'rejected'"), `${path} must classify expected redirects as rejected`);
    assert.match(routeSource, /code === 'server' \? 'failed' : 'rejected'/);
  }
});

test('malformed pricing forms are validation rejections rather than server failures', () => {
  for (const [path] of PRICING_ROUTES) {
    const routeSource = source(path);
    const formIndex = routeSource.indexOf('formData = await request.formData();');
    const validationIndex = routeSource.indexOf("'/pricing?error=validation'", formIndex);
    assert.ok(formIndex >= 0 && validationIndex > formIndex, `${path} must reject malformed form data as validation`);
  }
});

test('pricing request logs do not promote route, scope, or commercial form data into structured scope', () => {
  const forbidden = ['propertyId', 'roomTypeId', 'ratePlanId', 'addonId', 'baseRateId', 'chargeRuleId', 'amount', 'value', 'formData', 'request.url'];
  for (const [path] of PRICING_ROUTES) {
    const routeSource = source(path);
    const finishDefinition = routeSource.match(/const finish = [\s\S]*?;\n\n/);
    assert.ok(finishDefinition, `${path} must define the shared completion wrapper`);
    for (const field of forbidden) {
      assert.equal(finishDefinition[0].includes(field), false, `${path} must not log ${field}`);
    }
  }
});
