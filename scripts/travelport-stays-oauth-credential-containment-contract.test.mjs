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

test('terminal containment independently pins Stays authority to the secure configured origin', () => {
  assert.match(containment, /TRAVELPORT_STAYS_AUTHORITY_HEADERS[\s\S]*'authorization'[\s\S]*'xauth_travelport_accessgroup'/);
  assert.match(containment, /function carriesTravelportStaysAuthority\(/);
  assert.match(containment, /url\.protocol === 'https:'/);
  assert.match(containment, /url\.hostname === staysHost/);
  assert.match(containment, /url\.username === ''/);
  assert.match(containment, /url\.password === ''/);
  assert.match(containment, /url\.hash === ''/);
  assert.match(containment, /url\.hostname !== staysHost[\s\S]*carriesStaysAuthority[\s\S]*invalidCredentialContainment/);
  assert.match(containment, /!isSecureTravelportStaysTarget\(url, staysHost\)[\s\S]*invalidCredentialContainment/);
});

test('documentation keeps OAuth credential exchange separate from downstream Stays authorization', () => {
  assert.match(docs, /Authorization: Bearer <token>/);
  assert.match(docs, /XAUTH_TRAVELPORT_ACCESSGROUP/);
  assert.match(docs, /removes all four headers before network I\/O/);
  assert.match(docs, /secure configured HTTPS origin/);
  assert.match(docs, /bearer, or access-group authority/);
  assert.match(docs, /does not enable Travelport `reservation`/);
  assert.match(tracingDocs, /not provider request headers/);
  assert.match(tracingDocs, /removes all four before terminal Stays network I\/O/);
  assert.doesNotMatch(tracingDocs, /Stays may carry only the documented common Travelport credential\/content headers used by SF/);
});
