import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const paths = [
  'app/api/inventory/rentals/bookings/[booking-id]/security-bond/collection/route.ts',
  'app/api/inventory/rentals/bookings/[booking-id]/security-bond/release/route.ts',
];

test('bond collection and release classify only typed input failures', () => {
  for (const path of paths) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    assert.ok(source.includes("import { isRentalFinancialInputValidationError } from '@/server/payments/rental-financial-input-validation.ts';"), path);
    assert.ok(source.includes('isRentalFinancialInputValidationError(error)'), path);
    assert.ok(!/\.test\(error\.message\)/.test(source), path);
    assert.ok(!/message: error\.message/.test(source), path);
    assert.ok(source.includes('OrganizationPermissionDeniedError'), path);
    assert.ok(source.includes('RentalSecurityBondConflictError'), path);
    assert.ok(source.includes('RentalSecurityBondUnavailableError'), path);
    assert.ok(source.includes("code === 'server' ? 'failed' : 'rejected'"), path);
  }
});
