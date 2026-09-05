import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildStructuredRequestLogRecord } from '../src/server/observability/request-observability.ts';

const route = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const routes = [
  ['app/api/integrations/stripe/route.ts', 'integration.stripe.configure'],
  ['app/api/integrations/stripe/test/route.ts', 'integration.stripe.connection-test'],
  ['app/api/integrations/[integration-id]/status/route.ts', 'integration.lifecycle.update'],
];

test('redirect-based form failures can record logical failure without weakening HTTP failure classification', () => {
  const rejected = buildStructuredRequestLogRecord({
    requestId: 'sf-request.2026-09-05:integration-1',
    operation: 'integration.stripe.configure',
    statusCode: 303,
    durationMs: 1,
    failureOutcome: 'rejected',
  });
  assert.equal(rejected.outcome, 'rejected');
  assert.equal(rejected.level, 'warn');

  const failed = buildStructuredRequestLogRecord({
    requestId: 'sf-request.2026-09-05:integration-2',
    operation: 'integration.stripe.configure',
    statusCode: 303,
    durationMs: 1,
    failureOutcome: 'failed',
  });
  assert.equal(failed.outcome, 'failed');
  assert.equal(failed.level, 'error');

  const serverFailure = buildStructuredRequestLogRecord({
    requestId: 'sf-request.2026-09-05:integration-3',
    operation: 'integration.stripe.configure',
    statusCode: 500,
    durationMs: 1,
    failureOutcome: 'rejected',
  });
  assert.equal(serverFailure.outcome, 'failed');
  assert.equal(serverFailure.level, 'error');
});

test('integration management routes correlate every response and attach tenant scope only after active-tenant resolution', () => {
  for (const [path, operation] of routes) {
    const source = route(path);
    assert.match(source, new RegExp(`createRequestObservation\\(request, \\{ operation: '${operation.replaceAll('.', '\\.')}' \\}\\)`));
    assert.doesNotMatch(source, /console\.(?:log|info|warn|error)/);

    const tenantContextIndex = source.indexOf('await readActiveOrganizationContext(session.user.id)');
    const tenantScopeIndex = source.indexOf('organizationId = activeContext.organization.id;');
    assert.ok(tenantContextIndex >= 0, `${path} must resolve the active tenant`);
    assert.ok(tenantScopeIndex > tenantContextIndex, `${path} must not attach tenant log scope before active-tenant resolution`);

    assert.match(source, /if \(!isSameOriginAuthRequest\(request\)\) return finish\(/);
    assert.match(source, /if \(!isSupportedAuthFormRequest\(request\)\) return finish\(/);
    assert.match(source, /if \(!session\) return finish\(.+?, 'rejected'\);/);
    assert.match(source, /if \(!activeContext\.organization\) return finish\(.+?, 'rejected'\);/);
    assert.match(source, /code === 'server' \? 'failed' : 'rejected'/);

    const finishDefinition = source.slice(source.indexOf('const finish ='), source.indexOf('\n\n  if (!isSameOriginAuthRequest'));
    assert.doesNotMatch(finishDefinition, /request\.url|secretKey|webhookSecret|integrationId|actorUserId/);
  }
});

test('Stripe configuration and connection testing use only the reviewed static provider log scope', () => {
  for (const path of [
    'app/api/integrations/stripe/route.ts',
    'app/api/integrations/stripe/test/route.ts',
  ]) {
    const source = route(path);
    assert.match(source, /\{ organizationId, provider: 'stripe' \}/);
    assert.doesNotMatch(source, /provider:\s*(?:configuration|result|formData|params|request)/);
  }

  const testRoute = route('app/api/integrations/stripe/test/route.ts');
  assert.match(testRoute, /result\.status === 'HEALTHY' \? undefined : 'rejected'/);
});

test('generic lifecycle logging never copies the route integration id or form action into request-log scope', () => {
  const source = route('app/api/integrations/[integration-id]/status/route.ts');
  const finishDefinition = source.slice(source.indexOf('const finish ='), source.indexOf('\n\n  if (!isSameOriginAuthRequest'));
  assert.match(finishDefinition, /\{ organizationId \}/);
  assert.doesNotMatch(finishDefinition, /integrationId|action|provider|params/);
  assert.match(source, /return finish\(NextResponse\.redirect\(new URL\('\/integrations\?error=validation'/);
  assert.match(source, /return finish\(NextResponse\.redirect\(new URL\('\/integrations\?error=archive-confirmation'/);
});
