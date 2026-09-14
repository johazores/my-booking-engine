import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFileSync(new URL(path, root), 'utf8');

const containment = source('src/server/suppliers/travelport-stays-oauth-credential-containment-fetch.ts');
const docs = source('docs/travelport-stays-terminal-request-identity.md');

test('terminal Stays boundary independently constrains bearer authority', () => {
  assert.match(containment, /const MAX_TRAVELPORT_ACCESS_TOKEN_LENGTH = 16_384/);
  assert.match(containment, /const BEARER_PREFIX = 'Bearer '/);
  assert.match(containment, /function assertTravelportStaysBearerAuthorization\(headers: Headers\)/);
  assert.match(containment, /authorization === null/);
  assert.match(containment, /authorization\.length > BEARER_PREFIX\.length \+ MAX_TRAVELPORT_ACCESS_TOKEN_LENGTH/);
  assert.match(containment, /!\/\^Bearer \\S\+\$\/\.test\(authorization\)/);
  assert.match(
    containment,
    /containedStaysHeaders\(headers, input\.credentials\);\s*assertTravelportStaysBearerAuthorization\(headers\);\s*assertAllowedTerminalHeaders/,
  );
});

test('terminal Travelport network target is the validated URL string, not caller request identity', () => {
  assert.equal(
    (containment.match(/fetchImpl\(url\.href, terminalTravelportRequestInit\(method, body, signal, headers\)\)/g) ?? []).length,
    2,
  );
  assert.doesNotMatch(containment, /fetchImpl\(requestInput,/);
  assert.match(containment, /url = new URL\(requestUrl\(requestInput\)\)/);
});

test('terminal Travelport payload authority is independently constrained before network I/O', () => {
  assert.match(containment, /const MAX_TRAVELPORT_STAYS_REQUEST_BYTES = 4 \* 1024 \* 1024/);
  assert.match(containment, /const TRAVELPORT_JSON_CONTENT_TYPE = 'application\/json'/);
  assert.match(containment, /const TRAVELPORT_OAUTH_CONTENT_TYPE = 'application\/x-www-form-urlencoded'/);
  assert.match(containment, /function assertTravelportStaysTerminalBody\(/);
  assert.match(containment, /if \(method === 'GET'\) \{\s*if \(body !== null\) invalidCredentialContainment\(\)/);
  assert.match(containment, /typeof body !== 'string'/);
  assert.match(containment, /!body\.isWellFormed\(\)/);
  assert.match(containment, /!hasExactContentType\(headers, TRAVELPORT_JSON_CONTENT_TYPE\)/);
  assert.match(containment, /!hasJsonObjectEnvelope\(body\)/);
  assert.match(containment, /!hasUtf8ByteLengthAtMost\(body, MAX_TRAVELPORT_STAYS_REQUEST_BYTES\)/);
  assert.match(
    containment,
    /assertAllowedTerminalHeaders\(headers, TRAVELPORT_OAUTH_TERMINAL_ALLOWED_HEADERS\);\s*if \(!hasExactContentType\(headers, TRAVELPORT_OAUTH_CONTENT_TYPE\)\) invalidCredentialContainment\(\);\s*assertTravelportOAuthCredentialBody/,
  );
  assert.match(
    containment,
    /assertAllowedTerminalHeaders\(headers, TRAVELPORT_STAYS_TERMINAL_ALLOWED_HEADERS\);\s*assertTravelportStaysTerminalBody\(body, headers, method\);\s*return fetchImpl/,
  );
});

test('terminal request identity documentation keeps the capability boundary narrow', () => {
  assert.match(docs, /exact URL string that SF parsed and validated/);
  assert.match(docs, /calls the injected terminal Fetch implementation with `url\.href` rather than the original caller object/);
  assert.match(docs, /at most 16,384 token characters/);
  assert.match(docs, /Stays `GET` operations must have no request body/);
  assert.match(docs, /4 MiB UTF-8 request limit/);
  assert.match(docs, /OAuth `POST \/oauth\/token` requires the exact form content type/);
  assert.match(docs, /SearchComplete\/pricing, Rules, Availability, initial and reviewed Create, Booking\.com Sync, known-locator Retrieve/);
  assert.match(docs, /`reservation` remains deliberately unadvertised/);
});
