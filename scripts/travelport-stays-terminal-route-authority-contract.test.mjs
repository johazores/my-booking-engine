import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/server/suppliers/travelport-stays-oauth-credential-containment-fetch.ts', import.meta.url), 'utf8');
const docs = readFileSync(new URL('../docs/travelport-stays-terminal-route-authority.md', import.meta.url), 'utf8');

test('terminal credential boundary pins the implemented Travelport Stays route matrix', () => {
  assert.match(source, /searchComplete: '\/12\/hotel\/search\/searchcomplete'/);
  assert.match(source, /rules: '\/11\/hotel\/rules\/offershospitality\/buildfromrequest'/);
  assert.match(source, /availability: '\/11\/hotel\/availability\/catalogofferingshospitality'/);
  assert.match(source, /reservationBuild: '\/11\/hotel\/book\/reservations\/build'/);
  assert.match(source, /reservationCollection: '\/11\/hotel\/book\/reservations\/'/);
  assert.match(source, /function isSupportedTravelportStaysOperation\(url: URL, method: string\)/);
  assert.match(source, /hasExactPaginationQuery\(url\)/);
  assert.match(source, /hasAcceptedReservationReviewQuery\(url\)/);
  assert.match(source, /hasSingleCanonicalEncodedPathSegment\(url,/);
  assert.match(source, /isSecureTravelportStaysTarget\(url, targets\.staysHost, method\)/);
});

test('terminal route authority retains canonical continuation and reservation review constraints', () => {
  assert.match(source, /entries\.length === 1[\s\S]*?entries\[0\]\?\.\[0\] === 'pageNumber'[\s\S]*?\/\^\[2-5\]\$\//);
  assert.match(source, /acceptedKeys = new Set\(\['acceptPriceChangeInd', 'acceptGuaranteeChangeInd'\]\)/);
  assert.match(source, /seen\.has\(key\)[\s\S]*?value !== 'true'/);
  assert.match(source, /encodeURIComponent\(decodeURIComponent\(suffix\)\) === suffix/);
});

test('terminal route authority is documented as defense in depth and not capability activation', () => {
  assert.match(docs, /final SF-owned Travelport credential-containment fetch/);
  assert.match(docs, /every allowed operation family/);
  assert.match(docs, /fail as `INVALID_REQUEST` before terminal network I\/O/);
  assert.match(docs, /does not advertise or enable Travelport `reservation`/);
});
