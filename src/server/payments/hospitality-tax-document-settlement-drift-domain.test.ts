import assert from 'node:assert/strict';
import test from 'node:test';

import { findHospitalityTaxDocumentSettlementDrift } from './hospitality-tax-document-settlement-drift-domain.ts';

const REFUND_ONE = '11111111-1111-4111-8111-111111111111';
const REFUND_TWO = '22222222-2222-4222-8222-222222222222';
const REFUND_THREE = '33333333-3333-4333-8333-333333333333';

test('settlement drift is reported per exact legal document', () => {
  const drift = findHospitalityTaxDocumentSettlementDrift({
    authorities: [
      { documentNumber: 'AU-ADJ-00000001', refundTransactionIds: [REFUND_ONE] },
      { documentNumber: 'AU-ADJ-00000002', refundTransactionIds: [REFUND_TWO, REFUND_THREE] },
    ],
    currentRefunds: [
      { id: REFUND_ONE, status: 'SUCCEEDED' },
      { id: REFUND_TWO, status: 'FAILED' },
      { id: REFUND_THREE, status: 'SUCCEEDED' },
    ],
  });
  assert.deepEqual(drift, [{ documentNumber: 'AU-ADJ-00000002' }]);
  assert.equal(Object.isFrozen(drift), true);
  assert.equal(Object.isFrozen(drift[0]), true);
});

test('missing refund rows remain source-integrity concerns instead of settlement drift', () => {
  const drift = findHospitalityTaxDocumentSettlementDrift({
    authorities: [{ documentNumber: 'AU-ADJ-00000003', refundTransactionIds: [REFUND_ONE] }],
    currentRefunds: [],
  });
  assert.deepEqual(drift, []);
});

test('pending and ambiguous provider truth are current settlement drift', () => {
  const drift = findHospitalityTaxDocumentSettlementDrift({
    authorities: [
      { documentNumber: 'AU-ADJ-00000004', refundTransactionIds: [REFUND_ONE] },
      { documentNumber: 'AU-ADJ-00000005', refundTransactionIds: [REFUND_TWO] },
    ],
    currentRefunds: [
      { id: REFUND_ONE, status: 'PENDING' },
      { id: REFUND_TWO, status: 'AMBIGUOUS' },
    ],
  });
  assert.deepEqual(drift, [
    { documentNumber: 'AU-ADJ-00000004' },
    { documentNumber: 'AU-ADJ-00000005' },
  ]);
});

test('invalid or duplicate authority identity fails closed', () => {
  assert.throws(() => findHospitalityTaxDocumentSettlementDrift({
    authorities: [{ documentNumber: 'bad', refundTransactionIds: [REFUND_ONE] }],
    currentRefunds: [],
  }), /document number/i);
  assert.throws(() => findHospitalityTaxDocumentSettlementDrift({
    authorities: [
      { documentNumber: 'AU-ADJ-00000006', refundTransactionIds: [REFUND_ONE] },
      { documentNumber: 'AU-ADJ-00000006', refundTransactionIds: [REFUND_TWO] },
    ],
    currentRefunds: [],
  }), /duplicated/i);
  assert.throws(() => findHospitalityTaxDocumentSettlementDrift({
    authorities: [{ documentNumber: 'AU-ADJ-00000007', refundTransactionIds: [REFUND_ONE, REFUND_ONE] }],
    currentRefunds: [],
  }), /duplicated/i);
  assert.throws(() => findHospitalityTaxDocumentSettlementDrift({
    authorities: [{ documentNumber: 'AU-ADJ-00000008', refundTransactionIds: [REFUND_ONE] }],
    currentRefunds: [{ id: REFUND_ONE, status: 'SUCCEEDED' }, { id: REFUND_ONE, status: 'FAILED' }],
  }), /duplicated/i);
});
