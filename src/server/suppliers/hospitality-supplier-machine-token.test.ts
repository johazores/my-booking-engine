import assert from 'node:assert/strict';
import test from 'node:test';

import { isExactHospitalitySupplierMachineToken } from './hospitality-supplier-machine-token.ts';

test('accepts bounded exact supplier machine tokens without normalizing them', () => {
  assert.equal(isExactHospitalitySupplierMachineToken('ABC-123', 32), true);
  assert.equal(isExactHospitalitySupplierMachineToken('ABC 123', 32), true);
  assert.equal(isExactHospitalitySupplierMachineToken('x'.repeat(32), 32), true);
});

test('rejects padding, controls, empties and overlong supplier machine tokens', () => {
  for (const value of [
    '',
    ' ABC-123',
    'ABC-123 ',
    '\tABC-123',
    'ABC-123\n',
    'ABC\u0000-123',
    'ABC\u001f-123',
    'ABC\u007f-123',
    '\u00a0ABC-123',
  ]) {
    assert.equal(isExactHospitalitySupplierMachineToken(value, 32), false, JSON.stringify(value));
  }
  assert.equal(isExactHospitalitySupplierMachineToken('x'.repeat(33), 32), false);
  assert.equal(isExactHospitalitySupplierMachineToken(null, 32), false);
  assert.equal(isExactHospitalitySupplierMachineToken('ABC', 0), false);
});
