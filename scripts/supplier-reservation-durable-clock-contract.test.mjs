import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const reservationServicePath = 'src/server/suppliers/hospitality-supplier-reservation-service.ts';
const recoveryWriteServicePath = 'src/server/suppliers/hospitality-supplier-reservation-recovery-write-service.ts';
const durableClockDocPath = 'docs/supplier-reservation-durable-clock.md';

function databaseClockReads(text) {
  return text.match(/SELECT clock_timestamp\(\) AS "currentTime"/g) ?? [];
}

test('supplier reservation claims and settlements use database-authored durable clocks', () => {
  const service = source(reservationServicePath);

  assert.equal(databaseClockReads(service).length, 4);
  assert.doesNotMatch(service, /const attemptedAt = new Date\(\);/);
  assert.doesNotMatch(service, /const completedAt = new Date\(\);/);

  assert.match(
    service,
    /const attemptedAt = databaseClock\.currentTime;[\s\S]{0,450}lastAttemptAt: attemptedAt[\s\S]{0,450}startedAt: attemptedAt/,
  );
  assert.match(
    service,
    /const completedAt = databaseClock\.currentTime;[\s\S]{0,1500}completedAt,/,
  );
  assert.match(
    service,
    /const completedAt = databaseClock\.currentTime;[\s\S]{0,1500}reconciledAt: completedAt[\s\S]{0,1100}completedAt,/,
  );
});

test('supplier recovery-write claims and settlements use the same database clock authority', () => {
  const service = source(recoveryWriteServicePath);

  assert.equal(databaseClockReads(service).length, 2);
  assert.doesNotMatch(service, /const attemptedAt = new Date\(\);/);
  assert.doesNotMatch(service, /const completedAt = new Date\(\);/);

  assert.match(
    service,
    /const attemptedAt = databaseClock\.currentTime;[\s\S]{0,500}lastAttemptAt: attemptedAt[\s\S]{0,500}startedAt: attemptedAt/,
  );
  assert.match(
    service,
    /const completedAt = databaseClock\.currentTime;[\s\S]{0,1300}completedAt,/,
  );
});

test('durable-clock documentation separates commercial chronology from process observability time', () => {
  const doc = source(durableClockDocPath);

  assert.match(doc, /PostgreSQL `clock_timestamp\(\)`/);
  assert.match(doc, /application-node clocks are not commercial ordering authority/i);
  assert.match(doc, /observability timestamps/i);
  assert.match(doc, /Travelport `reservation` remains disabled/i);
});
