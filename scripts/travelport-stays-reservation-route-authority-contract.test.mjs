import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('reservation response authority independently pins the implemented reservation route matrix', () => {
  const wrapper = source('src/server/suppliers/travelport-stays-reservation-trace-fetch.ts');

  assert.match(wrapper, /const RESERVATION_BUILD_PATH = `\$\{RESERVATION_PATH_PREFIX\}\/build`;/);
  assert.match(wrapper, /const RESERVATION_COLLECTION_PATH = `\$\{RESERVATION_PATH_PREFIX\}\/`;/);
  assert.match(wrapper, /function isSupportedReservationRequest\(url: URL, method: string\)/);
  assert.match(wrapper, /url\.pathname === RESERVATION_BUILD_PATH[\s\S]*?method === 'POST'[\s\S]*?hasAcceptedReservationReviewQuery\(url\)/);
  assert.match(wrapper, /url\.pathname === RESERVATION_COLLECTION_PATH[\s\S]*?method === 'POST'[\s\S]*?url\.search === ''/);
  assert.match(wrapper, /hasCanonicalReservationReferencePath\(url\)[\s\S]*?method === 'GET'[\s\S]*?url\.search === ''/);
  assert.match(wrapper, /if \(!isSupportedReservationRequest\(url, method\)\) \{[\s\S]*?INVALID_REQUEST/);
  assert.doesNotMatch(
    wrapper,
    /if \(method !== 'POST' && method !== 'GET'\) return null;/,
    'unsupported methods inside the reservation namespace must fail closed instead of bypassing authority',
  );
});

test('reservation retrieve route authority shares the durable provider-reference boundary', () => {
  const wrapper = source('src/server/suppliers/travelport-stays-reservation-trace-fetch.ts');
  const reference = source('src/server/suppliers/travelport-stays-reservation-reference.ts');
  const recovery = source('src/server/suppliers/travelport-stays-reservation-recovery-provider.ts');

  assert.match(wrapper, /isCanonicalTravelportStaysReservationReferencePathSegment/);
  assert.match(reference, /const MAX_RESERVATION_REFERENCE_LENGTH = 512;/);
  assert.match(reference, /const ASCII_CONTROL_CHARACTER_PATTERN = \/\[\\u0000-\\u001f\\u007f\]\//);
  assert.match(reference, /normalized !== value/);
  assert.match(reference, /normalized\.length > MAX_RESERVATION_REFERENCE_LENGTH/);
  assert.match(reference, /!normalized\.isWellFormed\(\)/);
  assert.match(reference, /ASCII_CONTROL_CHARACTER_PATTERN\.test\(normalized\)/);
  assert.match(reference, /reference = decodeURIComponent\(value\)/);
  assert.match(reference, /encodeURIComponent\(reference\) === value/);
  assert.match(recovery, /normalizeTravelportStaysReservationReference\(authority\.providerReservationReference\)/);
  assert.match(recovery, /book\/reservations\/\$\{encodeURIComponent\(reference\)\}/);
  assert.doesNotMatch(recovery, /MAX_REFERENCE_LENGTH/);
});

test('reservation route authority keeps review flags and locator paths canonical', () => {
  const wrapper = source('src/server/suppliers/travelport-stays-reservation-trace-fetch.ts');

  assert.match(wrapper, /acceptedKeys = new Set\(\['acceptPriceChangeInd', 'acceptGuaranteeChangeInd'\]\)/);
  assert.match(wrapper, /seen\.has\(key\) \|\| value !== 'true'/);
  assert.match(wrapper, /url\.search === '' \|\| url\.search === `\?\$\{url\.searchParams\.toString\(\)\}`/);
});

test('reservation route documentation records the fail-closed namespace and bounded reference boundary', () => {
  const traceDoc = source('docs/travelport-reservation-response-trace-authority.md');
  const referenceDoc = source('docs/travelport-reservation-reference-route-authority.md');
  const unicodeDoc = source('docs/travelport-reservation-unicode-authority.md');

  assert.match(traceDoc, /`POST \/11\/hotel\/book\/reservations\/build`/);
  assert.match(traceDoc, /`POST \/11\/hotel\/book\/reservations\/`/);
  assert.match(traceDoc, /`GET \/11\/hotel\/book\/reservations\/\{AggregatorLocatorCode\}`/);
  assert.match(traceDoc, /passive/i);
  assert.match(referenceDoc, /512/);
  assert.match(referenceDoc, /leading\/trailing whitespace/i);
  assert.match(referenceDoc, /ASCII control/i);
  assert.match(referenceDoc, /well-formed UTF-16/i);
  assert.match(referenceDoc, /before provider I\/O/i);
  assert.match(referenceDoc, /shared reference authority/i);
  assert.match(unicodeDoc, /lone surrogate/i);
  assert.match(unicodeDoc, /INVALID_REQUEST/);
  assert.match(unicodeDoc, /INVALID_RESPONSE/);
});
