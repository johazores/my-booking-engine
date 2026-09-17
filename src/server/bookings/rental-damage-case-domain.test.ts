import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertRentalDamageCaseTransition,
  normalizeRentalDamageCaseAssessmentInput,
  normalizeRentalDamageCaseClosureInput,
  normalizeRentalDamageCaseCreateInput,
  normalizeRentalDamageCaseWaiverInput,
} from './rental-damage-case-domain.ts';

import { RentalInventoryValidationError } from '../inventory/rental-domain.ts';

test('damage case creation retains normalized non-empty summary evidence', () => {
  assert.deepEqual(
    normalizeRentalDamageCaseCreateInput({ summary: '  Scratched   rear panel  ' }),
    { summary: 'Scratched rear panel' },
  );
  assert.throws(
    () => normalizeRentalDamageCaseCreateInput({ summary: '   ' }),
    RentalInventoryValidationError,
  );
});

test('damage assessment parses exact money in retained booking currency', () => {
  assert.deepEqual(
    normalizeRentalDamageCaseAssessmentInput({
      estimatedRepairCostMajor: '125.50',
      notes: '  Replace   damaged panel. ',
    }, 'USD'),
    {
      estimatedRepairCostMinor: 12550n,
      currency: 'USD',
      notes: 'Replace damaged panel.',
    },
  );
  assert.throws(
    () => normalizeRentalDamageCaseAssessmentInput({
      estimatedRepairCostMajor: '12.345',
      notes: 'Estimate',
    }, 'USD'),
    /Estimated repair cost is invalid/,
  );
});

test('damage case waiver and closure require retained reason evidence', () => {
  assert.deepEqual(
    normalizeRentalDamageCaseWaiverInput({ reason: '  Normal wear and tear  ' }),
    { reason: 'Normal wear and tear' },
  );
  assert.deepEqual(
    normalizeRentalDamageCaseClosureInput({ notes: '  Repair completed  ' }),
    { notes: 'Repair completed' },
  );
  assert.throws(
    () => normalizeRentalDamageCaseWaiverInput({ reason: '' }),
    RentalInventoryValidationError,
  );
  assert.throws(
    () => normalizeRentalDamageCaseClosureInput({ notes: '' }),
    RentalInventoryValidationError,
  );
});

test('damage case lifecycle only permits dependency-safe transitions', () => {
  assert.doesNotThrow(() => assertRentalDamageCaseTransition('OPEN', 'ASSESSED'));
  assert.doesNotThrow(() => assertRentalDamageCaseTransition('OPEN', 'WAIVED'));
  assert.doesNotThrow(() => assertRentalDamageCaseTransition('ASSESSED', 'WAIVED'));
  assert.doesNotThrow(() => assertRentalDamageCaseTransition('ASSESSED', 'CLOSED'));
  assert.throws(() => assertRentalDamageCaseTransition('OPEN', 'CLOSED'));
  assert.throws(() => assertRentalDamageCaseTransition('CLOSED', 'WAIVED'));
  assert.throws(() => assertRentalDamageCaseTransition('WAIVED', 'ASSESSED'));
});
