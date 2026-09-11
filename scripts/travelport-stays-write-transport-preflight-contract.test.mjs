import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (path) => readFileSync(join(root, path), 'utf8');

test('Travelport write preflight reuses the exact credentialed transport with no network terminal', () => {
  const preflight = source('src/server/suppliers/travelport-stays-transport-preflight.ts');
  assert.match(preflight, /createTravelportStaysTraceFetch/);
  assert.match(preflight, /noIoTravelportStaysPreflightFetch/);
  assert.match(preflight, /new Response\(null, \{ status: 204 \}\)/);
  assert.match(preflight, /environment: input\.credentials\.environment/);
  assert.match(preflight, /credentials: input\.credentials/);
  assert.match(preflight, /fetchImpl: noIoTravelportStaysPreflightFetch/);
  assert.match(preflight, /await preflightFetch\(input\.requestInput, input\.init\)/);
  assert.doesNotMatch(preflight, /\bfetch\(input\.requestInput|globalThis\.fetch/);
});

test('initial and reviewed Create finish transport preflight before card acquisition and durable provider marker', () => {
  const executor = source('src/server/suppliers/travelport-stays-reservation-create-executor.ts');
  const commonStart = executor.indexOf('async #createReservation');
  const tokenIndex = executor.indexOf('const accessToken = await this.#accessToken()', commonStart);
  const headersIndex = executor.indexOf('const requestHeaders = Object.freeze', tokenIndex);
  const nonSensitivePreflightIndex = executor.indexOf('await assertTravelportStaysTransportRequestReady', headersIndex);
  const cardIndex = executor.indexOf('const paymentCard = await acquirePaymentCard()', nonSensitivePreflightIndex);
  const serializedIndex = executor.indexOf('const serializedBody = JSON.stringify(requestBody)', cardIndex);
  const finalPreflightIndex = executor.indexOf('await assertTravelportStaysTransportRequestReady', nonSensitivePreflightIndex + 1);
  const markerIndex = executor.indexOf('await beforeProviderRequest()', finalPreflightIndex);
  const fetchIndex = executor.indexOf('response = await this.#fetchImpl(reservationUrl', markerIndex);

  assert.ok(
    tokenIndex >= 0
      && headersIndex > tokenIndex
      && nonSensitivePreflightIndex > headersIndex
      && cardIndex > nonSensitivePreflightIndex
      && serializedIndex > cardIndex
      && finalPreflightIndex > serializedIndex
      && markerIndex > finalPreflightIndex
      && fetchIndex > markerIndex,
  );
  assert.match(executor.slice(nonSensitivePreflightIndex, cardIndex), /body: '\{\}'/);
  assert.match(executor.slice(finalPreflightIndex, markerIndex), /body: serializedBody/);
  assert.match(executor.slice(fetchIndex, fetchIndex + 700), /headers: requestHeaders/);
  assert.match(executor.slice(fetchIndex, fetchIndex + 700), /body: serializedBody/);
});

test('Booking.com Sync preflights the exact serialized write before durable provider marker', () => {
  const executor = source('src/server/suppliers/travelport-stays-reservation-sync-executor.ts');
  const methodStart = executor.indexOf('async syncReservation');
  const serializedIndex = executor.indexOf('const serializedBody = JSON.stringify(requestBody)', methodStart);
  const urlIndex = executor.indexOf('const reservationUrl =', serializedIndex);
  const headersIndex = executor.indexOf('const requestHeaders = Object.freeze', urlIndex);
  const preflightIndex = executor.indexOf('await assertTravelportStaysTransportRequestReady', headersIndex);
  const markerIndex = executor.indexOf('await beforeProviderRequest()', preflightIndex);
  const fetchIndex = executor.indexOf('response = await this.#fetchImpl(reservationUrl', markerIndex);

  assert.ok(
    serializedIndex >= 0
      && urlIndex > serializedIndex
      && headersIndex > urlIndex
      && preflightIndex > headersIndex
      && markerIndex > preflightIndex
      && fetchIndex > markerIndex,
  );
  assert.match(executor.slice(preflightIndex, markerIndex), /body: serializedBody/);
  assert.match(executor.slice(fetchIndex, fetchIndex + 700), /headers: requestHeaders/);
  assert.match(executor.slice(fetchIndex, fetchIndex + 700), /body: serializedBody/);
});

test('Travelport integration documentation keeps preflight separate from provider-I/O authority', () => {
  const doc = source('docs/travelport-stays-integration.md');
  assert.match(doc, /non-network preflight before acquiring PAN\/CVV/);
  assert.match(doc, /preflights that exact serialized request again before the durable provider-request marker/);
  assert.match(doc, /actual POST is independently validated again by the shared transport after marking/);
  assert.match(doc, /preflight is validation only/);
  assert.match(doc, /cannot prove that Travelport received a request/);
});
