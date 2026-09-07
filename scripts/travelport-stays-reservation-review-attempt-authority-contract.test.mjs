import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('review acceptance verifies the current durable provider-write attempt before credentials', () => {
  const service = source('src/server/suppliers/travelport-stays-reservation-review-acceptance-service.ts');
  const reservationRead = service.indexOf('db.hospitalitySupplierReservationOperation.findFirst');
  const attemptRead = service.indexOf('db.hospitalitySupplierReservationAttempt.findFirst', reservationRead);
  const attemptAuthority = service.indexOf('assertHospitalitySupplierReservationReviewAttemptAuthority', attemptRead);
  const integrationLoad = service.indexOf('loadTravelportStaysIntegration(input.organizationId)', attemptAuthority);

  assert.ok(reservationRead >= 0 && attemptRead > reservationRead && attemptAuthority > attemptRead && integrationLoad > attemptAuthority);
  assert.match(service, /organizationId: input\.organizationId,[\s\S]*reservationId: reservation\.id,[\s\S]*sequence: reservation\.attemptCount/);
});

test('review acceptance rechecks the same durable attempt under the operation lock before persistence', () => {
  const service = source('src/server/suppliers/travelport-stays-reservation-review-acceptance-service.ts');
  const transaction = service.indexOf('return db.$transaction');
  const lock = service.indexOf('pg_advisory_xact_lock', transaction);
  const latestRead = service.indexOf('transaction.hospitalitySupplierReservationOperation.findFirst', lock);
  const latestAttemptRead = service.indexOf('transaction.hospitalitySupplierReservationAttempt.findFirst', latestRead);
  const authority = service.indexOf('assertHospitalitySupplierReservationReviewAttemptAuthority', latestAttemptRead);
  const sameAttempt = service.indexOf('latestReviewAttempt.id !== reviewAttempt.id', authority);
  const persist = service.indexOf('reviewAcceptanceFingerprint: accepted.acceptanceFingerprint', sameAttempt);

  assert.ok(transaction >= 0 && lock > transaction && latestRead > lock && latestAttemptRead > latestRead);
  assert.ok(authority > latestAttemptRead && sameAttempt > authority && persist > sameAttempt);
});

test('review attempt authority requires exact review outcome and durable marked completion evidence', () => {
  const domain = source('src/server/suppliers/hospitality-supplier-reservation-review-attempt-authority.ts');
  assert.match(domain, /attempt\.sequence !== input\.reservation\.attemptCount/);
  assert.match(domain, /attempt\.kind !== 'CREATE'/);
  assert.match(domain, /attempt\.status !== 'REVIEW_REQUIRED'/);
  assert.match(domain, /attempt\.normalizedFailureCode !== requirements\.reason/);
  assert.match(domain, /attempt\.providerRequestStartedAt/);
  assert.match(domain, /attempt\.completedAt/);
});

test('documentation states that actor acceptance requires durable current-attempt evidence', () => {
  const docs = source('docs/supplier-reservation-review-acceptance.md');
  assert.match(docs, /current durable `CREATE` attempt/i);
  assert.match(docs, /provider-request marker/i);
  assert.match(docs, /same attempt is rechecked under the operation advisory lock/i);
});

test('review settlement and acceptance use the database clock for durable decision timestamps', () => {
  const settlement = source('src/server/suppliers/hospitality-supplier-reservation-review-service.ts');
  const acceptance = source('src/server/suppliers/travelport-stays-reservation-review-acceptance-service.ts');
  assert.match(settlement, /SELECT clock_timestamp\(\) AS \"currentTime\"/);
  assert.match(settlement, /completedAt = databaseClock\.currentTime/);
  assert.match(acceptance, /SELECT clock_timestamp\(\) AS \"currentTime\"/);
  assert.match(acceptance, /acceptedAt = databaseClock\.currentTime/);
});
