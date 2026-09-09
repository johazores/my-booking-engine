import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HOSPITALITY_SUPPLIER_CONFIRMATION_MISMATCH_FAILURE_CODE,
  HOSPITALITY_SUPPLIER_CONFIRMATION_MISSING_FAILURE_CODE,
  hospitalitySupplierReservationRecoveryConfirmationFailureCode,
  requiresSupplierConfirmationForReservationRecovery,
  supplierConfirmationMatchesDurableReservation,
} from './hospitality-supplier-reservation-confirmation-evidence.ts';

test('supplier confirmation recovery requirement is limited to the normalized missing-confirmation state', () => {
  assert.equal(
    requiresSupplierConfirmationForReservationRecovery(
      HOSPITALITY_SUPPLIER_CONFIRMATION_MISSING_FAILURE_CODE,
    ),
    true,
  );
  for (const failureCode of [null, undefined, 'INVALID_RESPONSE', 'TRAVELPORT_SELL_UNCERTAIN']) {
    assert.equal(requiresSupplierConfirmationForReservationRecovery(failureCode), false);
  }
});

test('known durable supplier confirmation cannot be silently replaced during recovery', () => {
  assert.equal(supplierConfirmationMatchesDurableReservation(null, null), true);
  assert.equal(supplierConfirmationMatchesDurableReservation(null, 'SUP-200'), true);
  assert.equal(supplierConfirmationMatchesDurableReservation('SUP-100', 'SUP-100'), true);
  assert.equal(supplierConfirmationMatchesDurableReservation('SUP-100', null), false);
  assert.equal(supplierConfirmationMatchesDurableReservation('SUP-100', 'SUP-200'), false);
  assert.equal(supplierConfirmationMatchesDurableReservation(' SUP-100', ' SUP-100'), false);
  assert.equal(supplierConfirmationMatchesDurableReservation('SUP-100\n', 'SUP-100\n'), false);
  assert.equal(HOSPITALITY_SUPPLIER_CONFIRMATION_MISMATCH_FAILURE_CODE, 'SUPPLIER_CONFIRMATION_MISMATCH');
});

test('recovery confirmation evidence fails closed before durable found or not-found settlement', () => {
  assert.equal(
    hospitalitySupplierReservationRecoveryConfirmationFailureCode({
      status: 'FOUND',
      lastFailureCode: null,
      durableSupplierConfirmationReference: 'SUP-100',
      recoveredSupplierConfirmationReference: 'SUP-100',
    }),
    null,
  );
  assert.equal(
    hospitalitySupplierReservationRecoveryConfirmationFailureCode({
      status: 'FOUND',
      lastFailureCode: null,
      durableSupplierConfirmationReference: 'SUP-100',
      recoveredSupplierConfirmationReference: null,
    }),
    HOSPITALITY_SUPPLIER_CONFIRMATION_MISMATCH_FAILURE_CODE,
  );
  assert.equal(
    hospitalitySupplierReservationRecoveryConfirmationFailureCode({
      status: 'FOUND',
      lastFailureCode: HOSPITALITY_SUPPLIER_CONFIRMATION_MISSING_FAILURE_CODE,
      durableSupplierConfirmationReference: null,
      recoveredSupplierConfirmationReference: null,
    }),
    HOSPITALITY_SUPPLIER_CONFIRMATION_MISSING_FAILURE_CODE,
  );
  assert.equal(
    hospitalitySupplierReservationRecoveryConfirmationFailureCode({
      status: 'FOUND',
      lastFailureCode: HOSPITALITY_SUPPLIER_CONFIRMATION_MISSING_FAILURE_CODE,
      durableSupplierConfirmationReference: null,
      recoveredSupplierConfirmationReference: 'SUP-200',
    }),
    null,
  );
  assert.equal(
    hospitalitySupplierReservationRecoveryConfirmationFailureCode({
      status: 'NOT_FOUND',
      lastFailureCode: null,
      durableSupplierConfirmationReference: 'SUP-100',
      recoveredSupplierConfirmationReference: null,
    }),
    HOSPITALITY_SUPPLIER_CONFIRMATION_MISMATCH_FAILURE_CODE,
  );
  assert.equal(
    hospitalitySupplierReservationRecoveryConfirmationFailureCode({
      status: 'NOT_FOUND',
      lastFailureCode: null,
      durableSupplierConfirmationReference: null,
      recoveredSupplierConfirmationReference: 'SUP-200',
    }),
    HOSPITALITY_SUPPLIER_CONFIRMATION_MISMATCH_FAILURE_CODE,
  );
  assert.equal(
    hospitalitySupplierReservationRecoveryConfirmationFailureCode({
      status: 'NOT_FOUND',
      lastFailureCode: null,
      durableSupplierConfirmationReference: null,
      recoveredSupplierConfirmationReference: '',
    }),
    HOSPITALITY_SUPPLIER_CONFIRMATION_MISMATCH_FAILURE_CODE,
  );
  assert.equal(
    hospitalitySupplierReservationRecoveryConfirmationFailureCode({
      status: 'NOT_FOUND',
      lastFailureCode: null,
      durableSupplierConfirmationReference: null,
      recoveredSupplierConfirmationReference: null,
    }),
    null,
  );
  assert.equal(
    hospitalitySupplierReservationRecoveryConfirmationFailureCode({
      status: 'NOT_FOUND',
      lastFailureCode: null,
      durableSupplierConfirmationReference: null,
      recoveredSupplierConfirmationReference: undefined,
    }),
    null,
  );
});
