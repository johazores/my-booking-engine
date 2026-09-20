import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('rental hold release route fails closed when booking conversion already consumed the hold', async () => {
  const route = await source('app/api/inventory/rentals/holds/[hold-id]/release/route.ts');

  assert.match(route, /releaseRentalAvailabilityHold/);
  assert.match(route, /RentalInventoryConflictError/);
  assert.match(route, /hold\.status === 'CONSUMED'/);
  assert.match(route, /already consumed into retained booking evidence and cannot be released/);
  assert.match(route, /hold\.status !== 'RELEASED' && hold\.status !== 'EXPIRED'/);
  assert.match(route, /Rental hold release did not reach a terminal release state/);

  const consumedGuard = route.indexOf("hold.status === 'CONSUMED'");
  const releaseSuccess = route.indexOf("const status = hold.status === 'EXPIRED'");
  assert.ok(consumedGuard >= 0 && releaseSuccess > consumedGuard);
});

test('rental hold release success is restricted to retained release or expiry outcomes', async () => {
  const route = await source('app/api/inventory/rentals/holds/[hold-id]/release/route.ts');

  assert.match(route, /hold\.status === 'EXPIRED' \? 'hold-expired' : 'hold-released'/);
  assert.match(route, /inventoryErrorCode\(error\)/);
  assert.match(route, /code === 'server' \? 'failed' : 'rejected'/);
});

test('rental hold lifecycle docs preserve consumed booking evidence and race semantics', async () => {
  const docs = await source('docs/rental-hold-release-lifecycle.md');

  assert.match(docs, /`CONSUMED` is different/);
  assert.match(docs, /must never be presented as `hold-released`/);
  assert.match(docs, /booking confirmation wins a race/);
  assert.match(docs, /database source-evidence guard keeps a consumed hold immutable/);
  assert.match(docs, /does not cancel a booking/);
});
