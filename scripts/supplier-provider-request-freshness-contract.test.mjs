import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const markerService = source('src/server/suppliers/hospitality-supplier-reservation-attempt-recovery-service.ts');
const createCoordinator = source('src/server/suppliers/travelport-stays-reservation-create-service.ts');
const syncCoordinator = source('src/server/suppliers/travelport-stays-reservation-sync-service.ts');
const reconciliationCoordinator = source('src/server/suppliers/hospitality-supplier-reservation-reconciliation-service.ts');
const reviewedCreateCoordinator = source('src/server/suppliers/travelport-stays-reservation-reviewed-create-service.ts');

test('provider-request marker preserves evidence replay but can require a fresh external-I/O permit', () => {
  const markerIndex = markerService.indexOf('export async function markHospitalitySupplierReservationProviderRequestStarted');
  const integrationIndex = markerService.indexOf('const integration = await transaction.integration.findFirst', markerIndex);
  const integrationAuthorityIndex = markerService.indexOf('assertProviderRequestIntegrationStillMatches(integration, reservation)', integrationIndex);
  const freshIndex = markerService.indexOf('if (attempt.providerRequestStartedAt && input.requireFreshProviderRequest)', integrationAuthorityIndex);
  const replayErrorIndex = markerService.indexOf('throw new HospitalitySupplierReservationProviderRequestAlreadyStartedError()', freshIndex);
  const replayIndex = markerService.indexOf('if (attempt.providerRequestStartedAt) return attempt', replayErrorIndex);
  const clockIndex = markerService.indexOf('SELECT clock_timestamp() AS "currentTime"', replayIndex);

  assert.ok(
    markerIndex >= 0
    && integrationIndex > markerIndex
    && integrationAuthorityIndex > integrationIndex
    && freshIndex > integrationAuthorityIndex
    && replayErrorIndex > freshIndex
    && replayIndex > replayErrorIndex
    && clockIndex > replayIndex,
  );
  assert.match(
    markerService,
    /export class HospitalitySupplierReservationProviderRequestAlreadyStartedError[\s\S]*?extends HospitalitySupplierReservationConflictError/,
  );
  assert.match(markerService, /requireFreshProviderRequest\?: boolean/);
});

test('Travelport Create and Sync require a fresh marker before each commercial provider write', () => {
  for (const coordinator of [createCoordinator, syncCoordinator]) {
    assert.match(
      coordinator,
      /beforeProviderRequest: async \(\) => \{[\s\S]*?markHospitalitySupplierReservationProviderRequestStarted\(\{[\s\S]*?requireFreshProviderRequest: true,[\s\S]*?\}\)/,
    );
    assert.match(
      coordinator,
      /error instanceof HospitalitySupplierReservationProviderRequestAlreadyStartedError[\s\S]*?providerRequestStarted = true[\s\S]*?if \(!providerRequestStarted\)/,
    );
  }
});

test('known-locator reconciliation also refuses to replay provider I/O on an existing marker', () => {
  const markerIndex = reconciliationCoordinator.indexOf('await markHospitalitySupplierReservationProviderRequestStarted');
  const freshIndex = reconciliationCoordinator.indexOf('requireFreshProviderRequest: true', markerIndex);
  const providerIndex = reconciliationCoordinator.indexOf('await input.provider.retrieveReservation', freshIndex);
  assert.ok(markerIndex >= 0 && freshIndex > markerIndex && providerIndex > freshIndex);
});

test('reviewed second Create keeps its separate atomic single-use commercial-consent boundary', () => {
  assert.match(reviewedCreateCoordinator, /consumeHospitalitySupplierReservationReviewAcceptanceForProviderRequest/);
  assert.doesNotMatch(reviewedCreateCoordinator, /markHospitalitySupplierReservationProviderRequestStarted/);
});
