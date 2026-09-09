import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HOSPITALITY_SUPPLIER_CONFIRMATION_MISSING_FAILURE_CODE,
  requiresSupplierConfirmationForReservationRecovery,
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
