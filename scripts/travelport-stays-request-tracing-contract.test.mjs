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

  for (const constructorName of [
    'TravelportStaysProvider',
    'TravelportStaysBookingTermsProvider',
    'TravelportStaysReservationAuthorityProvider',
    'TravelportStaysReservationCreateExecutor',
    'TravelportStaysReservationRecoveryProvider',
    'TravelportStaysReservationSyncExecutor',
  ]) {
    const constructorStart = integration.indexOf(`new ${constructorName}({`);
    assert.ok(constructorStart >= 0, `${constructorName} must be constructed by the integration loader`);
    assert.match(integration.slice(constructorStart, constructorStart + 700), /\bfetchImpl\b/);
  }
});

test('trace transport binds OAuth and exact implemented Stays request shapes to one configured environment', () => {
  const trace = source('src/server/suppliers/travelport-stays-trace-fetch.ts');
  assert.match(trace, /'pre-production'/);
  assert.match(trace, /api\.pp\.travelport\.net/);
  assert.match(trace, /auth\.pp\.travelport\.net/);
  assert.match(trace, /api\.travelport\.net/);
  assert.match(trace, /auth\.travelport\.net/);
  assert.match(trace, /method !== 'POST'/);
  assert.match(trace, /url\.protocol !== 'https:'/);
  assert.match(trace, /url\.port !== '' && url\.port !== '443'/);
  assert.match(trace, /url\.username !== ''/);
  assert.match(trace, /url\.password !== ''/);
  assert.match(trace, /url\.hash !== ''/);
  assert.match(trace, /url\.pathname !== '\/oauth\/token'/);
  assert.match(trace, /e2eTrackingId !== null/);
  assert.match(trace, /!e2eTrackingId\?\.startsWith\('sf-'\)/);
  assert.match(trace, /searchComplete: '\/12\/hotel\/search\/searchcomplete'/);
  assert.match(trace, /rules: '\/11\/hotel\/rules\/offershospitality\/buildfromrequest'/);
  assert.match(trace, /availability: '\/11\/hotel\/availability\/catalogofferingshospitality'/);
  assert.match(trace, /reservationBuild: '\/11\/hotel\/book\/reservations\/build'/);
  assert.match(trace, /reservationCollection: '\/11\/hotel\/book\/reservations\/'/);
  assert.match(trace, /hasCanonicalQueryEncoding/);
  assert.match(trace, /hasExactPaginationQuery/);
  assert.match(trace, /hasAcceptedReservationReviewQuery/);
  assert.match(trace, /hasSingleCanonicalEncodedPathSegment/);
  assert.match(trace, /assertSupportedTravelportStaysRequest\(url, method\)/);
  assert.match(trace, /headers\.set\('TraceId', traceId\)/);
  assert.match(trace, /headers\.set\('TVP-Trace-Id', traceId\)/);
  assert.match(trace, /redirect: 'manual'/);
});

test('trace transport keeps provider request deadlines active while bounding response-body memory', () => {
  const trace = source('src/server/suppliers/travelport-stays-trace-fetch.ts');
  assert.match(trace, /MAX_TRAVELPORT_OAUTH_RESPONSE_BYTES = 256 \* 1024/);
  assert.match(trace, /MAX_TRAVELPORT_STAYS_RESPONSE_BYTES = 32 \* 1024 \* 1024/);
  assert.match(trace, /async function bufferTravelportResponse\(response: Response, maxBytes: number\)/);
  assert.match(trace, /declaredTravelportResponseBytes\(response\)/);
  assert.match(trace, /response\.headers\.get\('Content-Length'\)/);
  assert.match(trace, /Number\.isSafeInteger\(value\)/);
  assert.match(trace, /if \(response\.body === null\) return response/);
  assert.match(trace, /const reader = response\.body\.getReader\(\)/);
  assert.match(trace, /const chunks: Uint8Array\[\] = \[\]/);
  assert.match(trace, /receivedBytes \+= value\.byteLength/);
  assert.match(trace, /receivedBytes > maxBytes/);
  assert.match(trace, /reader\.cancel\(\)\.catch/);
  assert.match(trace, /chunks\.push\(value\)/);
  assert.match(trace, /reader\.releaseLock\(\)/);
  assert.match(trace, /new ReadableStream<Uint8Array>/);
  assert.match(trace, /return new Response\(body/);
  assert.match(trace, /status: response\.status/);
  assert.match(trace, /statusText: response\.statusText/);
  assert.match(trace, /headers: response\.headers/);
  assert.match(trace, /bufferTravelportResponse\(response, MAX_TRAVELPORT_OAUTH_RESPONSE_BYTES\)/);
  assert.match(trace, /bufferTravelportResponse\(response, MAX_TRAVELPORT_STAYS_RESPONSE_BYTES\)/);
  assert.doesNotMatch(trace, /response\.clone\(\)/);
  assert.doesNotMatch(trace, /response\.arrayBuffer\(\)/);
});

test('request tracing documentation preserves reservation, environment, endpoint, timeout, memory, and privacy boundaries', () => {
  const doc = source('docs/travelport-stays-request-tracing.md');
  assert.match(doc, /does not enable Travelport `reservation`/);
  assert.match(doc, /PCI-safe FormOfPayment\/guarantee source/);
  assert.match(doc, /must not contain traveler names/);
  assert.match(doc, /validated integration environment/);
  assert.match(doc, /default HTTPS port/);
  assert.match(doc, /no URL userinfo/);
  assert.match(doc, /exact implemented Stays operation shapes/);
  assert.match(doc, /pageNumber=2\.\.5/);
  assert.match(doc, /only `true` acceptance flags/);
  assert.match(doc, /canonical adapter encoding/);
  assert.match(doc, /connection test uses the same environment-bound wrapper/);
  assert.match(doc, /forces `redirect: 'manual'`/);
  assert.match(doc, /automatically replayed to a redirect target/);
  assert.match(doc, /fully consumes each Travelport response body/);
  assert.match(doc, /timeout remains active until the complete provider payload is received/);
  assert.match(doc, /does not use `Response\.clone\(\)`/);
  assert.match(doc, /single unread replay stream/);
  assert.match(doc, /256 KiB for OAuth token responses/);
  assert.match(doc, /32 MiB for Stays responses/);
  assert.match(doc, /`Content-Length`/);
  assert.match(doc, /actual bytes delivered by the Fetch response stream/);
  assert.match(doc, /cancels the provider body/);
  assert.match(doc, /non-retryable `INVALID_RESPONSE`/);
});
