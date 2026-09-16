import assert from 'node:assert/strict';
import test from 'node:test';

import { RentalInventoryValidationError } from './rental-domain.ts';
import {
  assertRentalMaintenanceTransition,
  normalizeRentalMaintenanceCreateInput,
  normalizeRentalMaintenanceTransitionInput,
  rentalMaintenanceOperationalReason,
} from './rental-maintenance-domain.ts';

test('maintenance creation normalizes stable operational evidence', () => {
  assert.deepEqual(
    normalizeRentalMaintenanceCreateInput({
      idempotencyKey: 'rental-maintenance:abc-123',
      title: '  Inspect   front brake  ',
      description: '  Pads   are noisy.  ',
    }),
    {
      idempotencyKey: 'rental-maintenance:abc-123',
      title: 'Inspect front brake',
      description: 'Pads are noisy.',
    },
  );
  assert.equal(rentalMaintenanceOperationalReason('Inspect front brake'), 'Maintenance: Inspect front brake');
});

test('maintenance creation rejects weak identity and empty work', () => {
  assert.throws(
    () => normalizeRentalMaintenanceCreateInput({ idempotencyKey: 'bad key', title: 'Inspect' }),
    RentalInventoryValidationError,
  );
  assert.throws(
    () => normalizeRentalMaintenanceCreateInput({ idempotencyKey: 'maintenance:1', title: '   ' }),
    RentalInventoryValidationError,
  );
});

test('maintenance completion accepts optional retained notes', () => {
  assert.deepEqual(
    normalizeRentalMaintenanceTransitionInput({
      status: 'completed',
      completionNotes: '  Replaced   pads  ',
    }),
    { status: 'COMPLETED', completionNotes: 'Replaced pads', cancellationReason: null },
  );
});

test('maintenance cancellation requires retained reason', () => {
  assert.throws(
    () => normalizeRentalMaintenanceTransitionInput({ status: 'CANCELLED' }),
    RentalInventoryValidationError,
  );
  assert.deepEqual(
    normalizeRentalMaintenanceTransitionInput({ status: 'cancelled', cancellationReason: ' duplicate ' }),
    { status: 'CANCELLED', completionNotes: null, cancellationReason: 'duplicate' },
  );
});

test('maintenance transition payloads reject evidence for the wrong lifecycle', () => {
  assert.throws(
    () => normalizeRentalMaintenanceTransitionInput({ status: 'IN_PROGRESS', completionNotes: 'done' }),
    RentalInventoryValidationError,
  );
  assert.throws(
    () => normalizeRentalMaintenanceTransitionInput({ status: 'COMPLETED', cancellationReason: 'no' }),
    RentalInventoryValidationError,
  );
});

test('maintenance lifecycle is forward-only', () => {
  assert.doesNotThrow(() => assertRentalMaintenanceTransition('OPEN', 'IN_PROGRESS'));
  assert.doesNotThrow(() => assertRentalMaintenanceTransition('OPEN', 'COMPLETED'));
  assert.doesNotThrow(() => assertRentalMaintenanceTransition('IN_PROGRESS', 'CANCELLED'));
  assert.throws(
    () => assertRentalMaintenanceTransition('COMPLETED', 'IN_PROGRESS'),
    RentalInventoryValidationError,
  );
});
