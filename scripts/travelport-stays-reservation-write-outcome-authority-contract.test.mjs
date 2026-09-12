import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const helper = await readFile(
  new URL('../src/server/suppliers/travelport-stays-reservation-create-outcome-authority.ts', import.meta.url),
  'utf8',
);
const initialCreate = await readFile(
  new URL('../src/server/suppliers/travelport-stays-reservation-create-service.ts', import.meta.url),
  'utf8',
);
const reviewedCreate = await readFile(
  new URL('../src/server/suppliers/travelport-stays-reservation-reviewed-create-service.ts', import.meta.url),
  'utf8',
);
const sync = await readFile(
  new URL('../src/server/suppliers/travelport-stays-reservation-sync-service.ts', import.meta.url),
  'utf8',
);
const documentation = await readFile(
  new URL('../docs/travelport-reservation-write-outcome-authority.md', import.meta.url),
  'utf8',
);

test('write outcome materializer is branch-specific, frozen, bounded, and sanitized', () => {
  assert.match(helper, /MAX_OPERATIONAL_REFERENCE_LENGTH = 512/);
  assert.match(helper, /VALIDATION_FAILURE_CODE_PATTERN = \/\^TRAVELPORT_VALIDATION_\(\\d\{1,8\}\)\$\//);
  assert.match(helper, /DEFINITIVE_VALIDATION_SOURCE_CODES = new Set/);
  assert.match(helper, /RETRYABLE_VALIDATION_SOURCE_CODES = new Set/);
  assert.match(helper, /retryable !== expectedRetryable/);
  assert.match(helper, /new HospitalitySupplierProviderError\('INVALID_RESPONSE', FAILURE_MESSAGE\)/);
  assert.match(helper, /Object\.freeze\(\{/);
  assert.match(helper, /if \(status === 'CONFIRMED'\)/);
  assert.match(helper, /if \(status === 'FAILED'\)/);
  assert.match(helper, /if \(status === 'REVIEW_REQUIRED'\)/);
  assert.match(helper, /if \(status === 'AMBIGUOUS'\)/);
});

test('all Travelport reservation write services materialize returned provider outcomes before use', () => {
  assert.match(initialCreate, /rawCreateOutcome = await execution\.reservationCreateExecutor\.createReservation\(/);
  assert.match(initialCreate, /createOutcome = materializeTravelportStaysReservationCreateOutcome\(rawCreateOutcome\)/);
  assert.ok(initialCreate.indexOf('materializeTravelportStaysReservationCreateOutcome(rawCreateOutcome)') < initialCreate.indexOf('createOutcome.status'));

  assert.match(reviewedCreate, /rawCreateOutcome = await execution\.reservationCreateExecutor\.createReservationAfterAcceptedReview\(/);
  assert.match(reviewedCreate, /createOutcome = materializeTravelportStaysReservationCreateOutcome\(rawCreateOutcome\)/);
  assert.ok(reviewedCreate.indexOf('materializeTravelportStaysReservationCreateOutcome(rawCreateOutcome)') < reviewedCreate.indexOf('createOutcome.status'));

  assert.match(sync, /rawOutcome = await execution\.reservationSyncExecutor\.syncReservation\(/);
  assert.match(sync, /outcome = materializeTravelportStaysReservationSyncOutcome\(rawOutcome\)/);
  assert.ok(sync.indexOf('materializeTravelportStaysReservationSyncOutcome(rawOutcome)') < sync.indexOf('outcome.status'));
});

test('marker continuity remains fail closed before malformed provider results are consumed', () => {
  assert.ok(initialCreate.indexOf('if (!providerRequestStarted)') < initialCreate.indexOf('materializeTravelportStaysReservationCreateOutcome(rawCreateOutcome)'));
  assert.ok(reviewedCreate.indexOf('if (!providerRequestStarted)') < reviewedCreate.indexOf('materializeTravelportStaysReservationCreateOutcome(rawCreateOutcome)'));
  assert.ok(sync.indexOf('if (!providerRequestStarted)') < sync.indexOf('materializeTravelportStaysReservationSyncOutcome(rawOutcome)'));
  assert.match(documentation, /settled as `AMBIGUOUS \/ INVALID_RESPONSE`/);
  assert.match(documentation, /Travelport `reservation` remains deliberately disabled/);
  assert.match(documentation, /GitHub Actions are not used/);
});
