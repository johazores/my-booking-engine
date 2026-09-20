import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');

test('create route resolves current hold state after create/replay and rejects consumed booking evidence', async () => {
  const route = await source('app/api/inventory/rentals/holds/route.ts');

  assert.match(route, /createRentalAvailabilityHold/);
  assert.match(route, /readManagedRentalAvailabilityHoldState/);
  assert.match(route, /state\.hold\.status === 'CONSUMED'/);
  assert.match(route, /already consumed into retained booking evidence/);
  assert.match(route, /inventoryErrorCode\(error\)/);

  const stateRead = route.indexOf('readManagedRentalAvailabilityHoldState');
  const consumedGuard = route.indexOf("state.hold.status === 'CONSUMED'");
  const successRedirect = route.indexOf("const status = state.effective ? 'hold-active' : 'hold-inactive'");
  assert.ok(stateRead >= 0 && consumedGuard > stateRead && successRedirect > consumedGuard);
});

test('managed hold state remains tenant scoped and derives effectiveness from PostgreSQL time', async () => {
  const stateService = await source('src/server/inventory/rental-hold-state-service.ts');

  assert.match(stateService, /permission: 'availability:manage'/);
  assert.match(stateService, /id: input\.holdId,[\s\S]*organizationId: input\.organizationId/);
  assert.match(stateService, /SELECT clock_timestamp\(\) AS "now"/);
  assert.match(stateService, /effective: hold\.status === 'ACTIVE' && hold\.expiresAt > databaseClock\.now/);
});

test('hold lifecycle documentation distinguishes inactive history from consumed booking authority', async () => {
  const [releaseDocs, clockDocs] = await Promise.all([
    source('docs/rental-hold-release-lifecycle.md'),
    source('docs/rental-hold-database-clock-authority.md'),
  ]);

  assert.match(releaseDocs, /Create\/replay feedback after booking conversion/);
  assert.match(releaseDocs, /persisted `CONSUMED` result is different/);
  assert.match(releaseDocs, /does not mutate the consumed hold, reopen it, create another hold, cancel the booking/);
  assert.match(clockDocs, /durable state is `CONSUMED`/);
  assert.match(clockDocs, /route returns a conflict rather than a success status/);
});
