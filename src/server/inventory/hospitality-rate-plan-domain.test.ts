import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeHospitalityRatePlanInput } from './hospitality-rate-plan-domain.ts';

test('normalizes hospitality rate plan input', () => {
  assert.deepEqual(normalizeHospitalityRatePlanInput({
    propertyId: ' property-id ',
    name: '  Flexible   Room  ',
    code: ' flex-01 ',
    description: '  Cancel according to the configured policy.  ',
  }), {
    propertyId: 'property-id',
    name: 'Flexible Room',
    code: 'FLEX-01',
    description: 'Cancel according to the configured policy.',
  });
});

test('rejects invalid hospitality rate plan values', () => {
  assert.throws(
    () => normalizeHospitalityRatePlanInput({ propertyId: 'p', name: '', code: 'FLEX', description: '' }),
    /Rate plan name/,
  );
  assert.throws(
    () => normalizeHospitalityRatePlanInput({ propertyId: 'p', name: 'Flexible', code: 'bad code', description: '' }),
    /Rate plan code/,
  );
  assert.throws(
    () => normalizeHospitalityRatePlanInput({ propertyId: 'p', name: 'Flexible', code: 'FLEX', description: 'x'.repeat(301) }),
    /300 characters or fewer/,
  );
});
