import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const routes = [
  'app/api/inventory/rentals/bookings/[booking-id]/return/route.ts',
  'app/api/inventory/rentals/bookings/[booking-id]/pickup/route.ts',
  'app/api/inventory/rentals/bookings/[booking-id]/inventory-release/route.ts',
  'app/api/inventory/rentals/holds/[hold-id]/confirm/route.ts',
  'app/api/integrations/[integration-id]/status/route.ts',
];

test('rental and integration redirects use typed tenant IDs instead of message keywords', () => {
  for (const path of routes) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    assert.ok(source.includes("import { TenantIdentifierValidationError } from '@/server/tenancy/tenant-scope.ts';"), path);
    assert.ok(source.includes('error instanceof TenantIdentifierValidationError'), path);
    assert.ok(!source.includes('/invalid|required|must|cannot/i.test(error.message)'), path);
    assert.ok(!source.includes('/identifier|UUID/i.test(error.message)'), path);
    assert.ok(source.includes("code === 'server' ? 'failed' : 'rejected'"), path);
    assert.ok(!source.includes('message: error.message'), path);
  }
});

test('authenticated booking and payment HTTP mappers reject message-based validation authority', () => {
  for (const path of [
    'src/server/bookings/hospitality-booking-http.ts',
    'src/server/payments/payment-http.ts',
  ]) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    assert.ok(source.includes('error instanceof TenantIdentifierValidationError'), path);
    assert.ok(!source.includes('/must|required|invalid|cannot|between|at least|at most'), path);
    assert.ok(source.includes("{ error: 'internal-error' }, 500"), path);
  }
});
