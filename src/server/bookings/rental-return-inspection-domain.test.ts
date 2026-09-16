import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeRentalReturnInspectionInput,
  rentalReturnInspectionOperationalReason,
} from './rental-return-inspection-domain.ts';

test('normalizes clear return inspection evidence', () => {
  assert.deepEqual(
    normalizeRentalReturnInspectionInput({
      outcome: ' clear ',
      notes: '  No visible issues.  ',
    }),
    {
      outcome: 'CLEAR',
      notes: 'No visible issues.',
    },
  );
});

test('requires retained notes for non-clear outcomes', () => {
  assert.throws(
    () => normalizeRentalReturnInspectionInput({
      outcome: 'DAMAGE_REPORTED',
    }),
    /notes are required/i,
  );
  assert.throws(
    () => normalizeRentalReturnInspectionInput({
      outcome: 'UNSAFE',
      notes: '   ',
    }),
    /notes are required/i,
  );
});

test('uses bounded operational reasons for non-clear inspections', () => {
  assert.equal(
    rentalReturnInspectionOperationalReason('DAMAGE_REPORTED'),
    'Return inspection: damage reported',
  );
  assert.equal(
    rentalReturnInspectionOperationalReason('UNSAFE'),
    'Return inspection: unsafe condition',
  );
});
