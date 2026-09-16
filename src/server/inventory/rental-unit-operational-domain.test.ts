import assert from 'node:assert/strict';
import test from 'node:test';

import { RentalInventoryValidationError } from './rental-domain.ts';
import { normalizeRentalUnitOperationalStatusInput } from './rental-unit-operational-domain.ts';

test('available rental operational state clears any supplied reason', () => {
  assert.deepEqual(
    normalizeRentalUnitOperationalStatusInput({
      status: ' available ',
      reason: 'old maintenance note',
    }),
    { status: 'AVAILABLE', reason: null },
  );
});

test('out-of-service rental operational state requires and normalizes a reason', () => {
  assert.deepEqual(
    normalizeRentalUnitOperationalStatusInput({
      status: 'out_of_service',
      reason: '  rear brake requires service  ',
    }),
    { status: 'OUT_OF_SERVICE', reason: 'rear brake requires service' },
  );
  assert.throws(
    () => normalizeRentalUnitOperationalStatusInput({
      status: 'OUT_OF_SERVICE',
      reason: '   ',
    }),
    RentalInventoryValidationError,
  );
});

test('rental operational state rejects unsupported status and oversized reasons', () => {
  assert.throws(
    () => normalizeRentalUnitOperationalStatusInput({ status: 'MAINTENANCE' }),
    RentalInventoryValidationError,
  );
  assert.throws(
    () => normalizeRentalUnitOperationalStatusInput({
      status: 'OUT_OF_SERVICE',
      reason: 'x'.repeat(501),
    }),
    RentalInventoryValidationError,
  );
});
