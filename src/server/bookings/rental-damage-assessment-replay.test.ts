import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyRentalDamageAssessmentReplay } from './rental-damage-assessment-replay.ts';

const assessment = Object.freeze({ estimatedRepairCostMinor: 12550n, notes: 'Replace damaged panel.' });

test('damage assessment replay remains valid after later terminal case transitions', () => {
  for (const status of ['ASSESSED', 'WAIVED', 'CLOSED'] as const) {
    assert.equal(classifyRentalDamageAssessmentReplay({
      status,
      estimatedRepairCostMinor: 12550n,
      assessmentNotes: 'Replace damaged panel.',
    }, assessment), 'REPLAY');
  }
});

test('fresh open cases remain writable while mismatched retained assessments fail closed', () => {
  assert.equal(classifyRentalDamageAssessmentReplay({
    status: 'OPEN',
    estimatedRepairCostMinor: null,
    assessmentNotes: null,
  }, assessment), 'FRESH');

  assert.equal(classifyRentalDamageAssessmentReplay({
    status: 'CLOSED',
    estimatedRepairCostMinor: 12550n,
    assessmentNotes: 'Different retained notes.',
  }, assessment), 'CONFLICT');
});

test('a case waived directly from open does not invent historical assessment authority', () => {
  assert.equal(classifyRentalDamageAssessmentReplay({
    status: 'WAIVED',
    estimatedRepairCostMinor: null,
    assessmentNotes: null,
  }, assessment), 'INVALID_TRANSITION');
});
