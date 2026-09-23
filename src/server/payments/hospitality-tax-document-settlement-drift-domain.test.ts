import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findHospitalityCommercialTaxDocumentSettlementDrift,
  findHospitalityTaxDocumentSettlementDrift,
} from './hospitality-tax-document-settlement-drift-domain.ts';

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

test('commercial adjustment-note drift is reported from the current settlement result', () => {
  const drift = findHospitalityCommercialTaxDocumentSettlementDrift({
    currentSettlements: [
      {
        documentNumber: 'AU-ADJ-00000009',
        state: 'READY_TO_APPLY',
        settledAdjustmentMinor: 550n,
        remainingAdjustmentMinor: 0n,
        netSettledMinor: 550n,
        expectedAdjustmentMinor: 550n,
        expectedNetSettledMinor: 550n,
      },
      {
        documentNumber: 'AU-ADJ-00000010',
        state: 'REQUIRES_EXECUTION',
        settledAdjustmentMinor: 0n,
        remainingAdjustmentMinor: 550n,
        netSettledMinor: 1100n,
        expectedAdjustmentMinor: 550n,
        expectedNetSettledMinor: 550n,
      },
    ],
  });
  assert.deepEqual(drift, [{ documentNumber: 'AU-ADJ-00000010' }]);
  assert.equal(Object.isFrozen(drift), true);
  assert.equal(Object.isFrozen(drift[0]), true);
});

test('commercial settlement mismatch is drift even when the state label claims ready', () => {
  const drift = findHospitalityCommercialTaxDocumentSettlementDrift({
    currentSettlements: [{
      documentNumber: 'AU-ADJ-00000011',
      state: 'READY_TO_APPLY',
      settledAdjustmentMinor: 550n,
      remainingAdjustmentMinor: 0n,
      netSettledMinor: 600n,
      expectedAdjustmentMinor: 550n,
      expectedNetSettledMinor: 550n,
    }],
  });
  assert.deepEqual(drift, [{ documentNumber: 'AU-ADJ-00000011' }]);
});

test('invalid commercial settlement evidence fails closed', () => {
  assert.throws(() => findHospitalityCommercialTaxDocumentSettlementDrift({
    currentSettlements: [{
      documentNumber: 'bad',
      state: 'READY_TO_APPLY',
      settledAdjustmentMinor: 1n,
      remainingAdjustmentMinor: 0n,
      netSettledMinor: 1n,
      expectedAdjustmentMinor: 1n,
      expectedNetSettledMinor: 1n,
    }],
  }), /document number/i);
  assert.throws(() => findHospitalityCommercialTaxDocumentSettlementDrift({
    currentSettlements: [
      {
        documentNumber: 'AU-ADJ-00000012',
        state: 'READY_TO_APPLY',
        settledAdjustmentMinor: 1n,
        remainingAdjustmentMinor: 0n,
        netSettledMinor: 1n,
        expectedAdjustmentMinor: 1n,
        expectedNetSettledMinor: 1n,
      },
      {
        documentNumber: 'AU-ADJ-00000012',
        state: 'READY_TO_APPLY',
        settledAdjustmentMinor: 1n,
        remainingAdjustmentMinor: 0n,
        netSettledMinor: 1n,
        expectedAdjustmentMinor: 1n,
        expectedNetSettledMinor: 1n,
      },
    ],
  }), /duplicated/i);
  assert.throws(() => findHospitalityCommercialTaxDocumentSettlementDrift({
    currentSettlements: [{
      documentNumber: 'AU-ADJ-00000013',
      state: 'READY_TO_APPLY',
      settledAdjustmentMinor: 1n,
      remainingAdjustmentMinor: 1n,
      netSettledMinor: 1n,
      expectedAdjustmentMinor: 1n,
      expectedNetSettledMinor: 1n,
    }],
  }), /amounts/i);
});
