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

test('terminal containment pins Stays authority to the secure configured Hotel namespace', () => {
  assert.match(containment, /TRAVELPORT_STAYS_AUTHORITY_HEADERS[\s\S]*'authorization'[\s\S]*'xauth_travelport_accessgroup'/);
  assert.match(containment, /TRAVELPORT_STAYS_PATH_PREFIXES[\s\S]*'\/11\/hotel\/'[\s\S]*'\/12\/hotel\/'/);
  assert.match(containment, /function isSecureTravelportOrigin\(/);
  assert.match(containment, /url\.protocol === 'https:'/);
  assert.match(containment, /url\.hostname === host/);
  assert.match(containment, /url\.username === ''/);
  assert.match(containment, /url\.password === ''/);
  assert.match(containment, /url\.hash === ''/);
  assert.match(containment, /function isTravelportStaysPath\(/);
  assert.match(containment, /TRAVELPORT_STAYS_PATH_PREFIXES\.some\(\(prefix\) => url\.pathname\.startsWith\(prefix\)\)/);
  assert.match(containment, /url\.hostname !== targets\.staysHost\) invalidCredentialContainment\(\)/);
  assert.match(containment, /!isSecureTravelportStaysTarget\(url, targets\.staysHost\)\) invalidCredentialContainment\(\)/);
});

test('terminal containment independently pins OAuth credentials to the configured token endpoint', () => {
  assert.match(containment, /authenticationHost: 'auth\.pp\.travelport\.net'/);
  assert.match(containment, /authenticationHost: 'auth\.travelport\.net'/);
  assert.match(containment, /url\.pathname === '\/oauth\/token'/);
  assert.match(containment, /url\.search === ''/);
  assert.match(containment, /requestMethod\(requestInput, init\) !== 'POST'/);
  assert.match(containment, /carriesTravelportStaysAuthority\(headers\)/);
  assert.match(containment, /body instanceof URLSearchParams/);
  assert.match(containment, /entries\.length !== 5/);
  assert.match(containment, /values\.get\('grant_type'\) !== 'password'/);
  assert.match(containment, /values\.get\(name\) !== expected\[name\]/);
  assert.match(containment, /values\.size !== TRAVELPORT_OAUTH_CREDENTIAL_FIELDS\.length \+ 1/);
});

test('documentation keeps OAuth exchange and Stays product authority narrowly separated', () => {
  assert.match(docs, /Authorization: Bearer <token>/);
  assert.match(docs, /XAUTH_TRAVELPORT_ACCESSGROUP/);
  assert.match(docs, /same environment API hosts under `\/11\/air\/`/);
  assert.match(docs, /restricts Stays authority to `\/11\/hotel\/` or `\/12\/hotel\/`/);
  assert.match(docs, /exact five-field `URLSearchParams` password grant/);
  assert.match(docs, /same-host `\/11\/air\/` and other non-Hotel targets cannot receive Stays authority/);
  assert.match(docs, /does not enable Travelport `reservation`/);
  assert.match(tracingDocs, /not provider request headers/);
  assert.match(tracingDocs, /removes all four before terminal Stays network I\/O/);
  assert.doesNotMatch(tracingDocs, /Stays may carry only the documented common Travelport credential\/content headers used by SF/);
});
