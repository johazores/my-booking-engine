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

test('terminal request identity documentation keeps the capability boundary narrow', () => {
  assert.match(docs, /exact URL string that SF parsed and validated/);
  assert.match(docs, /calls the injected terminal Fetch implementation with `url\.href` rather than the original caller object/);
  assert.match(docs, /at most 16,384 token characters/);
  assert.match(docs, /SearchComplete\/pricing, Rules, Availability, initial and reviewed Create, Booking\.com Sync, known-locator Retrieve/);
  assert.match(docs, /`reservation` remains deliberately unadvertised/);
});
