import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('production Travelport integration wraps the shared transport with reservation response trace authority', () => {
  const integration = source('src/server/integrations/travelport-stays-integration.ts');
  assert.match(integration, /createTravelportStaysTraceFetch/);
  assert.match(integration, /createTravelportStaysReservationTraceAuthorityFetch/);
  assert.match(
    integration,
    /createTravelportStaysReservationTraceAuthorityFetch\(\s*createTravelportStaysTraceFetch\(/,
    'reservation trace authority must wrap the already-restricted Travelport transport',
  );
});

test('all implemented reservation executors and recovery provider receive the same protected transport', () => {
  const integration = source('src/server/integrations/travelport-stays-integration.ts');
  for (const constructorName of [
    'TravelportStaysReservationAuthorityProvider',
    'TravelportStaysReservationCreateExecutor',
    'TravelportStaysReservationRecoveryProvider',
    'TravelportStaysReservationSyncExecutor',
  ]) {
    const constructorIndex = integration.indexOf(`new ${constructorName}`);
    assert.notEqual(constructorIndex, -1, `${constructorName} must remain wired`);
    assert.notEqual(integration.indexOf('fetchImpl,', constructorIndex), -1, `${constructorName} must receive the protected fetch`);
  }
});
