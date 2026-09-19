import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');

test('fresh rental hold authority is derived from PostgreSQL time after idempotent replay', async () => {
  const holdService = await source('src/server/inventory/rental-hold-service.ts');

  assert.match(holdService, /async function readRentalHoldDatabaseClock/);
  assert.match(holdService, /SELECT clock_timestamp\(\) AS "now"/);
  assert.doesNotMatch(holdService, /input\.now|input\.now\s*\?\?\s*new Date\(\)/);

  const existingIndex = holdService.indexOf('const existing = await transaction.rentalAvailabilityHold.findUnique');
  const clockIndex = holdService.indexOf("readRentalHoldDatabaseClock(transaction, 'rental hold creation')");
  assert.ok(existingIndex >= 0 && clockIndex > existingIndex, 'idempotent replay must be evaluated before fresh time authority');

  assert.match(holdService, /const expiresAt = new Date\(now\.getTime\(\) \+ hold\.expiresInMinutes \* 60_000\)/);
  assert.match(holdService, /expiresAt:\s*\{ gt: now \}/);
  assert.match(holdService, /observedAt: now/);
  assert.match(holdService, /pricingObservedAt: now/);
  assert.match(holdService, /createdAt: now/);
});

test('rental hold list, pricing review, and release share database time authority', async () => {
  const holdService = await source('src/server/inventory/rental-hold-service.ts');

  for (const context of ['rental hold listing', 'rental hold pricing review', 'rental hold release']) {
    assert.match(holdService, new RegExp(`readRentalHoldDatabaseClock\\(transaction, '${context}'\\)`));
  }
  assert.match(holdService, /listRentalAvailabilityHolds[\s\S]*expiresAt:\s*\{ gt: now \}[\s\S]*isolationLevel: 'RepeatableRead'/);
  assert.match(holdService, /readRentalAvailabilityHoldPricingReview[\s\S]*effective: hold\.status === 'ACTIVE' && hold\.expiresAt > now[\s\S]*isolationLevel: 'RepeatableRead'/);
  assert.match(holdService, /releaseRentalAvailabilityHold[\s\S]*const status = current\.expiresAt <= now \? 'EXPIRED' as const : 'RELEASED' as const/);
  assert.match(holdService, /endedAt: now/);
});

test('create-route hold feedback uses a tenant-scoped database-clock state read', async () => {
  const [stateService, route] = await Promise.all([
    source('src/server/inventory/rental-hold-state-service.ts'),
    source('app/api/inventory/rentals/holds/route.ts'),
  ]);

  assert.match(stateService, /permission: 'availability:manage'/);
  assert.match(stateService, /assertUuidIdentifier\(input\.holdId, 'holdId'\)/);
  assert.match(stateService, /SELECT clock_timestamp\(\) AS "now"/);
  assert.match(stateService, /id: input\.holdId,[\s\S]*organizationId: input\.organizationId/);
  assert.match(stateService, /effective: hold\.status === 'ACTIVE' && hold\.expiresAt > databaseClock\.now/);
  assert.match(route, /readManagedRentalAvailabilityHoldState/);
  assert.match(route, /holdId: hold\.id/);
  assert.match(route, /state\.effective \? 'hold-active' : 'hold-inactive'/);
  assert.doesNotMatch(route, /hold\.expiresAt > new Date\(\)/);
});

test('related rental inventory mutations use PostgreSQL time for active-hold decisions', async () => {
  const rentalService = await source('src/server/inventory/rental-service.ts');

  assert.match(rentalService, /async function readRentalInventoryDatabaseClock/);
  assert.match(rentalService, /SELECT clock_timestamp\(\) AS "now"/);
  for (const context of ['rental unit relocation', 'rental availability-block creation', 'rental unit archival']) {
    assert.match(rentalService, new RegExp(`readRentalInventoryDatabaseClock\\(transaction, '${context}'\\)`));
  }
  assert.doesNotMatch(rentalService, /expiresAt:\s*\{ gt: new Date\(\) \}/);
  assert.match(rentalService, /assignRentalUnitLocation[\s\S]*expiresAt:\s*\{ gt: now \}/);
  assert.match(rentalService, /createRentalAvailabilityBlock[\s\S]*expiresAt:\s*\{ gt: now \}/);
  assert.match(rentalService, /archiveRentalUnit[\s\S]*expiresAt:\s*\{ gt: now \}/);
});

test('documentation keeps the database and application hold clocks aligned without inventing policy', async () => {
  const docs = await source('docs/rental-hold-database-clock-authority.md');

  assert.match(docs, /PostgreSQL time as the authority/i);
  assert.match(docs, /clock_timestamp\(\)/);
  assert.match(docs, /CURRENT_TIMESTAMP/);
  assert.match(docs, /idempotent replay/i);
  assert.match(docs, /create-hold HTTP route/i);
  assert.match(docs, /does not change hold duration policy/i);
  assert.match(docs, /GitHub Actions are not required or used/i);
});
