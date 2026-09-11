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
  assert.match(wrapper, /hasSingleCanonicalEncodedPathSegment\(url, RESERVATION_COLLECTION_PATH\)[\s\S]*?method === 'GET'[\s\S]*?url\.search === ''/);
  assert.match(wrapper, /if \(!isSupportedReservationRequest\(url, method\)\) \{[\s\S]*?INVALID_REQUEST/);
  assert.doesNotMatch(
    wrapper,
    /if \(method !== 'POST' && method !== 'GET'\) return null;/,
    'unsupported methods inside the reservation namespace must fail closed instead of bypassing authority',
  );
});

test('reservation route authority keeps review flags and locator paths canonical', () => {
  const wrapper = source('src/server/suppliers/travelport-stays-reservation-trace-fetch.ts');

  assert.match(wrapper, /acceptedKeys = new Set\(\['acceptPriceChangeInd', 'acceptGuaranteeChangeInd'\]\)/);
  assert.match(wrapper, /seen\.has\(key\) \|\| value !== 'true'/);
  assert.match(wrapper, /url\.search === '' \|\| url\.search === `\?\$\{url\.searchParams\.toString\(\)\}`/);
  assert.match(wrapper, /encodeURIComponent\(decodeURIComponent\(suffix\)\) === suffix/);
});

test('reservation response trace documentation records the fail-closed namespace boundary', () => {
  const doc = source('docs/travelport-reservation-response-trace-authority.md');

  assert.match(doc, /`POST \/11\/hotel\/book\/reservations\/build`/);
  assert.match(doc, /`POST \/11\/hotel\/book\/reservations\/`/);
  assert.match(doc, /`GET \/11\/hotel\/book\/reservations\/\{AggregatorLocatorCode\}`/);
  assert.match(doc, /before provider I\/O/i);
  assert.match(doc, /passive/i);
});
