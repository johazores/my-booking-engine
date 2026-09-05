import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFileSync(new URL(path, root), 'utf8');

const routes = [
  ['app/api/integrations/travelport-stays/route.ts', 'integration.travelport-stays.configure'],
  ['app/api/integrations/travelport-stays/test/route.ts', 'integration.travelport-stays.connection-test'],
];

test('Travelport management routes establish tenant scope before structured logging and never log credentials', () => {
  for (const [path, operation] of routes) {
    const route = source(path);
    assert.match(route, new RegExp(`createRequestObservation\\(request, \\{ operation: '${operation.replaceAll('.', '\\.')}' \\}\\)`));
    assert.match(route, /\{ organizationId, provider: 'travelport-stays' \}/);
    const tenantIndex = route.indexOf('await readActiveOrganizationContext(session.user.id)');
    const logScopeIndex = route.indexOf('organizationId = activeContext.organization.id;');
    assert.ok(tenantIndex >= 0 && logScopeIndex > tenantIndex);
    const finish = route.slice(route.indexOf('const finish ='), route.indexOf('\n\n  if (!isSameOriginAuthRequest'));
    assert.doesNotMatch(finish, /environment|username|password|clientId|clientSecret|accessGroup|token|request\.url|formData/);
    assert.match(route, /code === 'server' \? 'failed' : 'rejected'/);
  }
});

test('Travelport configuration derives capability server-side and the browser cannot submit tenant scope or capability claims', () => {
  const route = source('app/api/integrations/travelport-stays/route.ts');
  assert.match(route, /capabilities: configuration\.capabilities/);
  assert.match(route, /providerCode: 'travelport-stays'/);
  assert.doesNotMatch(route, /field\(formData, 'organizationId'\)|field\(formData, 'capabilities'\)/);
});

test('integration UI exposes only real Travelport management actions and labels hotel search as the sole current supplier capability', () => {
  const page = source('app/integrations/page.tsx');
  assert.match(page, /Travelport Stays/);
  assert.match(page, /currently exposes only normalized hotel search/);
  assert.match(page, /action="\/api\/integrations\/travelport-stays"/);
  assert.match(page, /testAction="\/api\/integrations\/travelport-stays\/test"/);
  assert.doesNotMatch(page, /Book with Travelport|Reserve with Travelport|fake|mock success/i);
});

test('provider research documents the current closed product boundary and official source references', () => {
  const gds = source('docs/gds-integration.md');
  const provider = source('docs/travelport-stays-integration.md');
  assert.match(gds, /selected first external hospitality supplier/);
  assert.match(gds, /No customer-facing external-supplier booking workflow is exposed yet/);
  assert.match(gds, /support\.travelport\.com\/webhelp\/JSONAPIs\/Hotelv11/);
  assert.match(provider, /capability list as `hotel-search`/);
  assert.match(provider, /reservation lifecycle remain closed/i);
  assert.match(provider, /24-hour TripServices access-token lifetime/);
});
