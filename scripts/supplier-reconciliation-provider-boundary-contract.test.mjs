import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const recoveryContract = source('src/server/suppliers/hospitality-supplier-reservation-recovery-provider.ts');
const coordinator = source('src/server/suppliers/hospitality-supplier-reservation-reconciliation-service.ts');
const travelportRecovery = source('src/server/suppliers/travelport-stays-reservation-recovery-provider.ts');
const correlationDoc = source('docs/supplier-reservation-correlation.md');

test('provider-neutral known-locator recovery requires an immediate pre-I/O callback', () => {
  assert.match(recoveryContract, /beforeProviderRequest: \(\) => Promise<void>/);
  assert.match(
    coordinator,
    /const beforeProviderRequest = async \(\) => \{[\s\S]*?markHospitalitySupplierReservationProviderRequestStarted\([\s\S]*?requireFreshProviderRequest: true,[\s\S]*?providerRequestStarted = true/,
  );
  const callbackIndex = coordinator.indexOf('const beforeProviderRequest = async () => {');
  const markerIndex = coordinator.indexOf('await markHospitalitySupplierReservationProviderRequestStarted', callbackIndex);
  const observerIndex = coordinator.indexOf('providerObservation = createHospitalitySupplierReservationProviderObservation({', markerIndex);
  const providerIndex = coordinator.indexOf('rawResult = await provider.retrieveReservation', observerIndex);
  assert.ok(callbackIndex >= 0 && markerIndex > callbackIndex && observerIndex > markerIndex && providerIndex > observerIndex);
  assert.match(
    coordinator,
    /provider\.retrieveReservation\(\{[\s\S]*?requestCorrelationId: claim\.attempt\.id,[\s\S]*?expectedReservation,[\s\S]*?beforeProviderRequest,[\s\S]*?\}\)/,
  );
  assert.match(coordinator, /if \(!providerRequestStarted\)[\s\S]*?status: 'UNKNOWN',[\s\S]*?failureCode: 'INVALID_REQUEST'/);
});

test('Travelport Retrieve completes validation, OAuth, and no-I/O transport preflight before the durable marker', () => {
  assert.match(travelportRecovery, /'beforeProviderRequest'/);
  assert.match(travelportRecovery, /typeof beforeProviderRequest !== 'function'/);

  const tokenIndex = travelportRecovery.indexOf('const accessToken = await this.#accessToken()');
  const preflightIndex = travelportRecovery.indexOf('await assertTravelportStaysTransportRequestReady', tokenIndex);
  const markerIndex = travelportRecovery.indexOf('await beforeProviderRequest()', preflightIndex);
  const fetchIndex = travelportRecovery.indexOf('const response = await fetchWithTimeout', markerIndex);

  assert.ok(tokenIndex >= 0 && preflightIndex > tokenIndex && markerIndex > preflightIndex && fetchIndex > markerIndex);
  assert.match(correlationDoc, /deterministic validation, OAuth, and transport-policy preflight/i);
  assert.match(correlationDoc, /does not fabricate `providerRequestStartedAt` after a provider returns/i);
});
