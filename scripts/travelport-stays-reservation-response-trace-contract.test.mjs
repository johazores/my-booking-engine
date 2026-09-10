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

test('Travelport HTTP 500 reservation errors cannot bypass response trace authority', () => {
  const reservationTraceFetch = source('src/server/suppliers/travelport-stays-reservation-trace-fetch.ts');
  assert.match(
    reservationTraceFetch,
    /response\.status > 500/,
    'only provider/gateway statuses above HTTP 500 may bypass payload trace authority',
  );
  assert.doesNotMatch(
    reservationTraceFetch,
    /response\.status >= 500/,
    'HTTP 500 carries documented Stays business error evidence and must remain trace-bound',
  );
});

test('status-only reservation failures cannot leak uncorrelated body or trace authority downstream', () => {
  const reservationTraceFetch = source('src/server/suppliers/travelport-stays-reservation-trace-fetch.ts');
  assert.match(reservationTraceFetch, /return rebuildStatusOnlyResponse\(response\)/);
  assert.match(reservationTraceFetch, /headers\.delete\('traceId'\)/);
  assert.match(reservationTraceFetch, /return new Response\(null,/);
});

test('reservation response trace scope uses a path-segment boundary instead of a raw prefix match', () => {
  const reservationTraceFetch = source('src/server/suppliers/travelport-stays-reservation-trace-fetch.ts');
  assert.match(
    reservationTraceFetch,
    /pathname === RESERVATION_PATH_PREFIX \|\| pathname\.startsWith\(`\$\{RESERVATION_PATH_PREFIX\}\/`\)/,
  );
  assert.doesNotMatch(reservationTraceFetch, /if \(!url\.pathname\.startsWith\(RESERVATION_PATH_PREFIX\)\)/);
});
