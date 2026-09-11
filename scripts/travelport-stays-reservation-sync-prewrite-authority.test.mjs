import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('Travelport Sync snapshots response identity authority before external work', () => {
  const executor = source('src/server/suppliers/travelport-stays-reservation-sync-executor.ts');
  const syncStart = executor.indexOf('async syncReservation(');
  assert.notEqual(syncStart, -1, 'Sync executor entry point must remain present');
  const syncBody = executor.slice(syncStart);

  const identitySnapshot = syncBody.indexOf('const expectedReservation = materializeTravelportStaysCreateExpectedReservation(callerExpectedReservation);');
  const requestConstruction = syncBody.indexOf('buildTravelportStaysReservationSyncRequest({');
  const oauth = syncBody.indexOf('await this.#accessToken()');
  const preflight = syncBody.indexOf('await assertTravelportStaysTransportRequestReady({');
  const marker = syncBody.indexOf('await beforeProviderRequest();');
  const providerCall = syncBody.indexOf('response = await this.#fetchImpl(');
  const settlement = syncBody.indexOf('expectedReservation,');

  assert.ok(identitySnapshot >= 0, 'Sync must snapshot the expected reservation identity');
  assert.ok(requestConstruction > identitySnapshot, 'identity must be fixed before Sync request construction');
  assert.ok(oauth > requestConstruction, 'OAuth must remain after deterministic request construction');
  assert.ok(preflight > oauth, 'transport preflight must remain after OAuth');
  assert.ok(marker > preflight, 'durable provider marker must remain after deterministic preflight');
  assert.ok(providerCall > marker, 'commercial provider I/O must remain after the durable marker');
  assert.ok(settlement > providerCall, 'response classification must reuse the snapshotted identity');
  assert.doesNotMatch(
    syncBody.slice(oauth),
    /input\.(requestCorrelationId|providerRecoveryReference|supplierConfirmationReference|traveler|expectedReservation|beforeProviderRequest)/,
    'post-OAuth execution must not return to caller-owned Sync authority',
  );
});

test('Travelport shared expected-reservation snapshot is exact, bounded, and immutable', () => {
  const authority = source('src/server/suppliers/travelport-stays-reservation-expected-authority.ts');

  assert.match(authority, /function materializeTravelportStaysCreateExpectedReservation\(/);
  assert.match(authority, /\^\[A-Za-z0-9\]\{1,16\}\$/);
  assert.match(authority, /\^\[A-Za-z0-9\]\{1,32\}\$/);
  assert.match(authority, /!validLocalDate\(snapshot\.arrivalDateLocal\)/);
  assert.match(authority, /!validLocalDate\(snapshot\.departureDateLocal\)/);
  assert.match(authority, /snapshot\.departureDateLocal <= snapshot\.arrivalDateLocal/);
  assert.match(authority, /snapshot\.rooms !== 1/);
  assert.match(authority, /\(snapshot\.guests as number\) < 1/);
  assert.match(authority, /\(snapshot\.guests as number\) > 9/);
  assert.match(authority, /const snapshot = Object\.freeze\(\{[\s\S]*?chainCode: expected\.chainCode,[\s\S]*?guests: expected\.guests,/);
  assert.match(authority, /return snapshot as TravelportStaysCreateExpectedReservation/);
});

test('Travelport Sync cache authority rejects the full ASCII control range', () => {
  const executor = source('src/server/suppliers/travelport-stays-reservation-sync-executor.ts');

  assert.match(executor, /const ASCII_CONTROL_PATTERN = \/\[\\u0000-\\u001f\\u007f\]\//);
  assert.match(executor, /ASCII_CONTROL_PATTERN\.test\(normalized\)/);
  assert.match(executor, /boundedSingleLine\(input\.cacheKey, 'Travelport reservation Sync cache key', MAX_CACHE_KEY_LENGTH\)/);
});

test('Sync pre-write identity authority is documented as a disabled defense-in-depth boundary', () => {
  const doc = source('docs/travelport-sync-prewrite-identity-authority.md');

  assert.match(doc, /before OAuth, transport preflight, the durable provider-request marker/i);
  assert.match(doc, /immutable snapshot/i);
  assert.match(doc, /caller-owned object/i);
  assert.match(doc, /does not enable Travelport `reservation`/i);
  assert.match(doc, /U\+0000.*U\+001F.*U\+007F/i);
});
