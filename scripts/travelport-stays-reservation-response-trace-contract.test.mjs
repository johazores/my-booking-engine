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

test('production Travelport transport strips reservation status-only bodies before shared replay buffering', () => {
  const integration = source('src/server/integrations/travelport-stays-integration.ts');
  const statusOnlyBoundary = source('src/server/suppliers/travelport-stays-reservation-status-only-response-fetch.ts');
  assert.match(integration, /createTravelportStaysReservationStatusOnlyResponseFetch/);
  assert.match(
    integration,
    /const reservationStatusOnlyFetch = createTravelportStaysReservationStatusOnlyResponseFetch\(fetch\);[\s\S]*?createTravelportStaysTraceFetch\(\{[\s\S]*?fetchImpl: reservationStatusOnlyFetch,/,
    'status-only reservation response minimization must run inside the shared replay-buffer transport',
  );
  assert.match(statusOnlyBoundary, /status === 401 \|\| status === 403 \|\| status === 429 \|\| status > 500/);
  assert.match(statusOnlyBoundary, /cancelResponseBody\(response\.body\)/);
  assert.match(statusOnlyBoundary, /return new Response\(null,/);
  assert.doesNotMatch(statusOnlyBoundary, /status >= 500/);
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
  const statusOnlyBoundary = source('src/server/suppliers/travelport-stays-reservation-status-only-response-fetch.ts');
  assert.match(
    statusOnlyBoundary,
    /status > 500/,
    'only provider/gateway statuses above HTTP 500 may bypass payload trace authority',
  );
  assert.doesNotMatch(
    statusOnlyBoundary,
    /status >= 500/,
    'HTTP 500 carries documented Stays business error evidence and must remain trace-bound',
  );
  assert.match(
    reservationTraceFetch,
    /isTravelportStaysReservationStatusOnlyResponse\(response\.status\)/,
    'the outer trace boundary must use the shared exact status-family predicate',
  );
});

test('status-only reservation failures use one shared minimization authority at both transport layers', () => {
  const reservationTraceFetch = source('src/server/suppliers/travelport-stays-reservation-trace-fetch.ts');
  const statusOnlyBoundary = source('src/server/suppliers/travelport-stays-reservation-status-only-response-fetch.ts');
  assert.match(
    reservationTraceFetch,
    /rebuildTravelportStaysReservationStatusOnlyResponse\(response\)/,
  );
  assert.match(
    statusOnlyBoundary,
    /boundedTravelportStaysReservationRetryAfter\(response\.headers\.get\('Retry-After'\)\)/,
  );
  assert.match(statusOnlyBoundary, /cancelResponseBody\(response\.body\)/);
  assert.match(statusOnlyBoundary, /const headers = new Headers\(\)/);
  assert.match(statusOnlyBoundary, /return new Response\(null,/);
  assert.doesNotMatch(reservationTraceFetch, /function boundedRetryAfterHeader/);
  assert.doesNotMatch(reservationTraceFetch, /function rebuildStatusOnlyResponse/);
  assert.doesNotMatch(
    statusOnlyBoundary,
    /function rebuildTravelportStaysReservationStatusOnlyResponse[\s\S]*?new Headers\(response\.headers\)/,
    'status-only responses must not clone arbitrary provider headers',
  );
  assert.doesNotMatch(
    statusOnlyBoundary,
    /function rebuildTravelportStaysReservationStatusOnlyResponse[\s\S]*?statusText: response\.statusText/,
    'provider status text is not status-only authority',
  );
});

test('v11 reservation response authority rejects the v12-only trace header', () => {
  const reservationTraceFetch = source('src/server/suppliers/travelport-stays-reservation-trace-fetch.ts');
  assert.match(reservationTraceFetch, /response\.headers\.has\('TVP-Trace-Id'\)/);
  assert.match(reservationTraceFetch, /response\.headers\.get\('traceId'\) !== reservation\.expectedTraceId/);
});

test('reservation response trace scope uses a path-segment boundary instead of a raw prefix match', () => {
  const reservationTraceFetch = source('src/server/suppliers/travelport-stays-reservation-trace-fetch.ts');
  assert.match(
    reservationTraceFetch,
    /pathname === RESERVATION_PATH_PREFIX \|\| pathname\.startsWith\(`\$\{RESERVATION_PATH_PREFIX\}\/`\)/,
  );
  assert.doesNotMatch(reservationTraceFetch, /if \(!url\.pathname\.startsWith\(RESERVATION_PATH_PREFIX\)\)/);
});

test('status-only response documentation preserves the shared minimizer and activation boundary', () => {
  const doc = source('docs/travelport-reservation-status-only-response-authority.md');
  assert.match(doc, /same provider-specific status predicate and rebuilding function/);
  assert.match(doc, /cancels an unread provider body best-effort/);
  assert.match(doc, /HTTP `500` is not status-only/);
  assert.match(doc, /does not advertise or enable Travelport `reservation`/);
});
