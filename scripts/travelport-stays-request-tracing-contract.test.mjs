import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (path) => readFileSync(join(root, path), 'utf8');

test('production Travelport adapters and connection tests share the environment-bound trace transport wrapper', () => {
  const integration = source('src/server/integrations/travelport-stays-integration.ts');
  assert.match(integration, /createTravelportStaysTraceFetch/);
  assert.match(integration, /environment: normalizedCredentials\.environment/);
  assert.match(integration, /fetchImpl: input\.fetchImpl/);
  assert.match(integration, /probeTravelportStaysIntegrationHealth\(\{[\s\S]*fetchImpl/);
  assert.match(integration, /const fetchImpl = createTravelportStaysTraceFetch\(\{[\s\S]*environment: normalizedCredentials\.environment/);

  const providerStart = integration.indexOf('new TravelportStaysProvider');
  const termsStart = integration.indexOf('new TravelportStaysBookingTermsProvider', providerStart);
  const authorityStart = integration.indexOf('new TravelportStaysReservationAuthorityProvider', termsStart);
  const recoveryStart = integration.indexOf('new TravelportStaysReservationRecoveryProvider', authorityStart);
  assert.ok(providerStart >= 0 && termsStart > providerStart && authorityStart > termsStart && recoveryStart > authorityStart);

  const providerBlock = integration.slice(providerStart, termsStart);
  const termsBlock = integration.slice(termsStart, authorityStart);
  const authorityBlock = integration.slice(authorityStart, recoveryStart);
  const recoveryBlock = integration.slice(recoveryStart);
  for (const block of [providerBlock, termsBlock, authorityBlock, recoveryBlock]) assert.match(block, /fetchImpl/);
});

test('trace transport binds OAuth and correlated Stays targets to one configured environment', () => {
  const trace = source('src/server/suppliers/travelport-stays-trace-fetch.ts');
  assert.match(trace, /'pre-production'/);
  assert.match(trace, /api\.pp\.travelport\.net/);
  assert.match(trace, /auth\.pp\.travelport\.net/);
  assert.match(trace, /api\.travelport\.net/);
  assert.match(trace, /auth\.travelport\.net/);
  assert.match(trace, /requestMethod\(requestInput, init\) !== 'POST'/);
  assert.match(trace, /url\.protocol !== 'https:'/);
  assert.match(trace, /url\.port !== '' && url\.port !== '443'/);
  assert.match(trace, /url\.username !== ''/);
  assert.match(trace, /url\.password !== ''/);
  assert.match(trace, /url\.hash !== ''/);
  assert.match(trace, /url\.pathname !== '\/oauth\/token'/);
  assert.match(trace, /e2eTrackingId !== null/);
  assert.match(trace, /!e2eTrackingId\?\.startsWith\('sf-'\)/);
  assert.match(trace, /url\.pathname\.startsWith\('\/11\/hotel\/'\)/);
  assert.match(trace, /headers\.set\('TraceId', traceId\)/);
  assert.match(trace, /url\.pathname\.startsWith\('\/12\/hotel\/'\)/);
  assert.match(trace, /headers\.set\('TVP-Trace-Id', traceId\)/);
});

test('request tracing documentation preserves reservation, environment, target, and privacy boundaries', () => {
  const doc = source('docs/travelport-stays-request-tracing.md');
  assert.match(doc, /does not enable Travelport `reservation`/);
  assert.match(doc, /PCI-safe FormOfPayment\/guarantee source/);
  assert.match(doc, /must not contain traveler names/);
  assert.match(doc, /validated integration environment/);
  assert.match(doc, /default HTTPS port/);
  assert.match(doc, /no URL userinfo/);
  assert.match(doc, /connection test uses the same environment-bound wrapper/);
  assert.match(doc, /manual redirects/);
});
