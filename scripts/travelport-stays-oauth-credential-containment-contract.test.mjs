import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFileSync(new URL(path, root), 'utf8');

const integration = source('src/server/integrations/travelport-stays-integration.ts');
const containment = source('src/server/suppliers/travelport-stays-oauth-credential-containment-fetch.ts');
const docs = source('docs/travelport-stays-oauth-credential-containment.md');
const tracingDocs = source('docs/travelport-stays-request-tracing.md');

const LONG_LIVED_HEADERS = ['username', 'password', 'client_id', 'client_secret'];

test('production Travelport integration places OAuth credential containment before network terminals', () => {
  assert.equal((integration.match(/createTravelportStaysOAuthCredentialContainmentFetch\(/g) ?? []).length, 2);
  assert.match(
    integration,
    /const credentialContainedFetch = createTravelportStaysOAuthCredentialContainmentFetch\([\s\S]*?const fetchImpl = createTravelportStaysTraceFetch\([\s\S]*?fetchImpl: credentialContainedFetch/,
  );
  assert.match(
    integration,
    /const credentialContainedFetch = createTravelportStaysOAuthCredentialContainmentFetch\([\s\S]*?const reservationStatusOnlyFetch = createTravelportStaysReservationStatusOnlyResponseFetch\(credentialContainedFetch\)[\s\S]*?createTravelportStaysTraceFetch\([\s\S]*?fetchImpl: reservationStatusOnlyFetch/,
  );
});

test('containment consumes exact long-lived credential headers instead of forwarding them', () => {
  for (const name of LONG_LIVED_HEADERS) {
    assert.match(containment, new RegExp(`'${name}'`));
  }
  assert.match(containment, /presentHeaders\.length !== LONG_LIVED_OAUTH_CREDENTIAL_HEADERS\.length/);
  assert.match(containment, /headers\.get\(name\) !== expected\[name\]/);
  assert.match(containment, /headers\.delete\(name\)/);
  assert.match(containment, /headers\.get\('XAUTH_TRAVELPORT_ACCESSGROUP'\) !== credentials\.accessGroup/);
});

test('terminal containment pins Stays authority to the secure configured operation matrix', () => {
  assert.match(containment, /TRAVELPORT_STAYS_AUTHORITY_HEADERS[\s\S]*'authorization'[\s\S]*'xauth_travelport_accessgroup'/);
  assert.match(containment, /searchComplete: '\/12\/hotel\/search\/searchcomplete'/);
  assert.match(containment, /rules: '\/11\/hotel\/rules\/offershospitality\/buildfromrequest'/);
  assert.match(containment, /availability: '\/11\/hotel\/availability\/catalogofferingshospitality'/);
  assert.match(containment, /reservationBuild: '\/11\/hotel\/book\/reservations\/build'/);
  assert.match(containment, /reservationCollection: '\/11\/hotel\/book\/reservations\/'/);
  assert.match(containment, /function isSecureTravelportOrigin\(/);
  assert.match(containment, /url\.protocol === 'https:'/);
  assert.match(containment, /url\.hostname === host/);
  assert.match(containment, /url\.username === ''/);
  assert.match(containment, /url\.password === ''/);
  assert.match(containment, /url\.hash === ''/);
  assert.match(containment, /function isSupportedTravelportStaysOperation\(url: URL, method: string\)/);
  assert.match(containment, /hasExactPaginationQuery\(url\)/);
  assert.match(containment, /hasAcceptedReservationReviewQuery\(url\)/);
  assert.match(containment, /hasSingleCanonicalEncodedPathSegment\(url,/);
  assert.match(containment, /url\.hostname !== targets\.staysHost\) invalidCredentialContainment\(\)/);
  assert.match(containment, /!isSecureTravelportStaysTarget\(url, targets\.staysHost, method\)\) invalidCredentialContainment\(\)/);
  assert.doesNotMatch(containment, /TRAVELPORT_STAYS_PATH_PREFIXES|isTravelportStaysPath/);
});

test('terminal containment independently pins OAuth credentials to the configured token endpoint', () => {
  assert.match(containment, /authenticationHost: 'auth\.pp\.travelport\.net'/);
  assert.match(containment, /authenticationHost: 'auth\.travelport\.net'/);
  assert.match(containment, /url\.pathname === '\/oauth\/token'/);
  assert.match(containment, /url\.search === ''/);
  assert.match(containment, /method !== 'POST'/);
  assert.match(containment, /carriesTravelportStaysAuthority\(headers\)/);
  assert.match(containment, /body instanceof URLSearchParams/);
  assert.match(containment, /entries\.length !== 5/);
  assert.match(containment, /values\.get\('grant_type'\) !== 'password'/);
  assert.match(containment, /values\.get\(name\) !== expected\[name\]/);
  assert.match(containment, /values\.size !== TRAVELPORT_OAUTH_CREDENTIAL_FIELDS\.length \+ 1/);
});

test('terminal containment projects network-safe Fetch metadata without spreading caller init', () => {
  assert.match(containment, /function effectiveRequestSignal\(/);
  assert.match(containment, /TRAVELPORT_OAUTH_TERMINAL_ALLOWED_HEADERS[\s\S]*'accept'[\s\S]*'content-type'/);
  assert.match(containment, /TRAVELPORT_STAYS_TERMINAL_ALLOWED_HEADERS[\s\S]*'authorization'[\s\S]*'xauth_travelport_accessgroup'/);
  assert.match(containment, /function assertAllowedTerminalHeaders\(/);
  assert.match(containment, /function terminalTravelportRequestInit\(/);
  assert.match(containment, /method: string/);
  assert.match(containment, /body: BodyInit \| null/);
  assert.match(containment, /signal: AbortSignal \| null \| undefined/);
  assert.match(containment, /cache: 'no-store'/);
  assert.match(containment, /credentials: 'omit'/);
  assert.match(containment, /redirect: 'manual'/);
  assert.match(containment, /referrer: ''/);
  assert.match(containment, /referrerPolicy: 'no-referrer'/);
  assert.match(containment, /keepalive: false/);
  assert.match(containment, /integrity: ''/);
  assert.match(containment, /if \(body !== null\) requestInit\.body = body/);
  assert.match(containment, /if \(signal !== undefined\) requestInit\.signal = signal/);
  assert.equal((containment.match(/assertAllowedTerminalHeaders\(headers, TRAVELPORT_[A-Z_]+_TERMINAL_ALLOWED_HEADERS\)/g) ?? []).length, 2);
  assert.equal((containment.match(/terminalTravelportRequestInit\(method, body, signal, headers\)/g) ?? []).length, 2);
  assert.doesNotMatch(containment, /fetchImpl\(requestInput, \{ \.\.\.init/);
});

test('documentation keeps OAuth exchange and exact Stays operation authority narrowly separated', () => {
  assert.match(docs, /Authorization: Bearer <token>/);
  assert.match(docs, /XAUTH_TRAVELPORT_ACCESSGROUP/);
  assert.match(docs, /same environment API hosts under `\/11\/air\/`/);
  assert.match(docs, /exact implemented Stays operation matrix/);
  assert.match(docs, /SearchComplete plus continuation, Rules, Availability plus continuation, Create\/reviewed Create, reservation Sync, and known-locator Retrieve/);
  assert.match(docs, /exact five-field `URLSearchParams` password grant/);
  assert.match(docs, /fresh terminal `RequestInit` instead of spreading arbitrary caller metadata/);
  assert.match(docs, /network-visible header allowlist after internal long-lived Stays credential headers are consumed/);
  assert.match(docs, /same-host `\/11\/air\/`, unrelated Hotel operations, wrong methods, unsupported pagination\/query shapes, and unimplemented reservation subresources cannot receive Stays authority/);
  assert.match(docs, /does not enable Travelport `reservation`/);
  assert.match(tracingDocs, /not provider request headers/);
  assert.match(tracingDocs, /removes all four before terminal Stays network I\/O/);
  assert.match(tracingDocs, /terminal credential-containment layer now repeats that network-safe projection/);
  assert.match(tracingDocs, /independently reapplies the network-visible OAuth\/Stays header allowlists/);
  assert.doesNotMatch(tracingDocs, /shared environment-bound transport is the final redirect-suppression authority/);
  assert.doesNotMatch(tracingDocs, /Stays may carry only the documented common Travelport credential\/content headers used by SF/);
});
