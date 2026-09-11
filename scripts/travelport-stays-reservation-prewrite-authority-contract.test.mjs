import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const createExecutor = await readFile(new URL('../src/server/suppliers/travelport-stays-reservation-create-executor.ts', import.meta.url), 'utf8');
const syncExecutor = await readFile(new URL('../src/server/suppliers/travelport-stays-reservation-sync-executor.ts', import.meta.url), 'utf8');

function methodBody(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `${startNeedle} must remain present`);
  const end = source.indexOf(endNeedle, start);
  assert.notEqual(end, -1, `${endNeedle} must remain present after ${startNeedle}`);
  return source.slice(start, end);
}

test('Create materializes caller-owned execution authority before its first async boundary', () => {
  const body = methodBody(createExecutor, 'async #createReservation(', '\n  }\n}');
  const accessToken = body.indexOf('await this.#accessToken()');
  assert.ok(accessToken > 0);
  const preAwait = body.slice(0, accessToken);
  const postAwait = body.slice(accessToken);

  for (const binding of [
    'requestCorrelationId',
    'requestMaterial',
    'paymentAuthority',
    'acquirePaymentCard',
    'expectedReservation: callerExpectedReservation',
    'beforeProviderRequest',
  ]) {
    assert.ok(preAwait.includes(binding), `${binding} must be materialized before OAuth`);
  }
  assert.ok(preAwait.includes('materializeTravelportStaysCreateExpectedReservation(callerExpectedReservation)'));
  assert.doesNotMatch(postAwait, /input\.(requestCorrelationId|requestMaterial|paymentAuthority|acquirePaymentCard|expectedReservation|beforeProviderRequest)/);
  assert.match(postAwait, /validThroughDateLocal: expectedReservation\.departureDateLocal/);
  assert.match(postAwait, /expectedReservation,\n\s*\}\);/);
});

test('Sync materializes caller-owned execution authority before its first async boundary', () => {
  const body = methodBody(syncExecutor, 'async syncReservation(', '\n  }\n}');
  const accessToken = body.indexOf('await this.#accessToken()');
  assert.ok(accessToken > 0);
  const preAwait = body.slice(0, accessToken);
  const postAwait = body.slice(accessToken);

  for (const binding of [
    'requestCorrelationId',
    'providerRecoveryReference',
    'supplierConfirmationReference',
    'traveler',
    'expectedReservation: callerExpectedReservation',
    'beforeProviderRequest',
  ]) {
    assert.ok(preAwait.includes(binding), `${binding} must be materialized before OAuth`);
  }
  assert.ok(preAwait.includes('materializeTravelportStaysCreateExpectedReservation(callerExpectedReservation)'));
  assert.doesNotMatch(postAwait, /input\.(requestCorrelationId|providerRecoveryReference|supplierConfirmationReference|traveler|expectedReservation|beforeProviderRequest)/);
  assert.match(postAwait, /supplierConfirmationReference,\n\s*\}\);/);
});
