import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const CUSTOMER_ROUTES = [
  ['app/api/customers/route.ts', 'customer.create'],
  ['app/api/customers/[customer-id]/route.ts', 'customer.update'],
  ['app/api/customers/[customer-id]/archive/route.ts', 'customer.archive'],
  ['app/api/customers/[customer-id]/deidentify/route.ts', 'customer.deidentify'],
];

function source(path) {
  return readFileSync(path, 'utf8');
}

test('customer lifecycle mutations emit correlated completion records with organization-only scope', () => {
  for (const [path, operation] of CUSTOMER_ROUTES) {
    const routeSource = source(path);
    assert.ok(routeSource.includes(`operation: '${operation}'`), `${path} must use ${operation}`);
    assert.match(routeSource, /createRequestObservation\(request, \{ operation: '[^']+' \}\)/);
    assert.match(routeSource, /observation\.finish\(/);
    assert.match(routeSource, /\{ organizationId \}/);
    assert.doesNotMatch(routeSource, /observation\.finish\([^;]*customerId/s);
    assert.doesNotMatch(routeSource, /observation\.finish\([^;]*firstName/s);
    assert.doesNotMatch(routeSource, /observation\.finish\([^;]*lastName/s);
    assert.doesNotMatch(routeSource, /observation\.finish\([^;]*email/s);
    assert.doesNotMatch(routeSource, /observation\.finish\([^;]*phone/s);
    assert.doesNotMatch(routeSource, /observation\.finish\([^;]*notes/s);
  }
});

test('customer log tenant scope is attached only after active-organization authority is established', () => {
  for (const [path] of CUSTOMER_ROUTES) {
    const routeSource = source(path);
    const authorityIndex = routeSource.indexOf('await readActiveOrganizationContext(session.user.id)');
    const scopeIndex = routeSource.indexOf('organizationId = activeContext.organization.id;');
    assert.ok(authorityIndex >= 0 && scopeIndex > authorityIndex, `${path} must establish tenant authority before log scope`);
  }
});

test('customer auth and tenant infrastructure failures are observed as HTTP 500', () => {
  for (const [path] of CUSTOMER_ROUTES) {
    const routeSource = source(path);
    const sessionIndex = routeSource.indexOf('await readAuthSession();');
    const tenantIndex = routeSource.indexOf('await readActiveOrganizationContext(session.user.id)');
    const sessionFailureIndex = routeSource.indexOf("new Response('Internal Server Error', { status: 500 })", sessionIndex);
    const tenantFailureIndex = routeSource.indexOf("new Response('Internal Server Error', { status: 500 })", tenantIndex);
    assert.ok(sessionIndex >= 0 && sessionFailureIndex > sessionIndex, `${path} must observe session-read failures`);
    assert.ok(tenantIndex > sessionFailureIndex && tenantFailureIndex > tenantIndex, `${path} must observe tenant lookup failures`);
  }
});

test('customer redirect failures preserve rejected-versus-failed outcomes', () => {
  for (const [path] of CUSTOMER_ROUTES) {
    const routeSource = source(path);
    assert.ok(routeSource.includes("'rejected'"), `${path} must classify expected redirect failures as rejected`);
    assert.match(routeSource, /code === 'server' \? 'failed' : 'rejected'/);
  }
});

test('customer request logging never promotes route or form customer data into structured scope', () => {
  for (const [path] of CUSTOMER_ROUTES) {
    const routeSource = source(path);
    const finishStart = routeSource.indexOf('const finish = ');
    const ingressStart = routeSource.indexOf('if (!isSameOriginAuthRequest(request))', finishStart);
    assert.ok(finishStart >= 0 && ingressStart > finishStart, `${path} must define the shared completion wrapper`);
    const finishDefinition = routeSource.slice(finishStart, ingressStart);
    assert.equal(finishDefinition.includes('customerId'), false);
    assert.equal(finishDefinition.includes('formData'), false);
    assert.equal(finishDefinition.includes('request.url'), false);
  }
});
