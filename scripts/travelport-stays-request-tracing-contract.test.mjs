import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (path) => readFileSync(join(root, path), 'utf8');

test('production Travelport adapters share the version-aware trace transport wrapper', () => {
  const integration = source('src/server/integrations/travelport-stays-integration.ts');
  assert.match(integration, /createTravelportStaysTraceFetch/);
  assert.match(integration, /const fetchImpl = createTravelportStaysTraceFetch\(\)/);

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

test('trace transport maps only supported Travelport Stays hosts and versions', () => {
  const trace = source('src/server/suppliers/travelport-stays-trace-fetch.ts');
  assert.match(trace, /api\.pp\.travelport\.net/);
  assert.match(trace, /api\.travelport\.net/);
  assert.match(trace, /url\.protocol !== 'https:'/);
  assert.match(trace, /url\.pathname\.startsWith\('\/11\/hotel\/'\)/);
  assert.match(trace, /headers\.set\('TraceId', traceId\)/);
  assert.match(trace, /url\.pathname\.startsWith\('\/12\/hotel\/'\)/);
  assert.match(trace, /headers\.set\('TVP-Trace-Id', traceId\)/);
  assert.match(trace, /E2ETrackingID/);
});

test('request tracing documentation preserves reservation and privacy boundaries', () => {
  const doc = source('docs/travelport-stays-request-tracing.md');
  assert.match(doc, /does not enable Travelport `reservation`/);
  assert.match(doc, /PCI-safe payment\/guarantee strategy/);
  assert.match(doc, /must not contain traveler names/);
  assert.match(doc, /manual redirects/);
});
