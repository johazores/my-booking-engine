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

test('integration UI accurately describes live read capabilities and disabled reservation writes', () => {
  const page = source('app/integrations/page.tsx');
  assert.match(page, /Travelport Stays/);
  assert.match(page, /SF supports normalized hotel search, exact offer pricing and revalidation/);
  assert.match(page, /server-side booking-rule and selected-offer authority review/);
  assert.match(page, /Reservation, modification and cancellation remain unavailable/);
  assert.match(page, /action="\/api\/integrations\/travelport-stays"/);
  assert.match(page, /testAction="\/api\/integrations\/travelport-stays\/test"/);
  assert.doesNotMatch(page, /Book with Travelport|Reserve with Travelport|fake|mock success/i);
});

test('provider research documents the current closed product boundary and official source references', () => {
  const gds = source('docs/gds-integration.md');
  const provider = source('docs/travelport-stays-integration.md');
  assert.match(gds, /first external hospitality supplier boundary/);
  assert.match(gds, /no customer\/staff reserve action is exposed/);
  assert.match(gds, /support\.travelport\.com\/webhelp\/JSONAPIs\/Hotelv11/);
  assert.match(provider, /configured capability list remains read-only: `availability`, `hotel-search`, and `pricing`/);
  assert.match(provider, /`reservation` remains disabled until/);
  assert.match(provider, /OAuth responses use the request-start clock/);
  const core = source('src/server/suppliers/travelport-stays-provider-core.ts');
  assert.match(core, /capabilities: Object\.freeze\(\['availability', 'hotel-search', 'pricing'\] as const\)/);
});
