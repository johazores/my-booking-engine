import assert from 'node:assert/strict';
import test from 'node:test';

import { RentalInventoryValidationError } from '../inventory/rental-domain.ts';
import { normalizeRentalDamageLiabilityDecisionInput } from './rental-damage-liability-domain.ts';

test('customer liability requires an exact positive amount within the retained repair estimate', () => {
  assert.deepEqual(
    normalizeRentalDamageLiabilityDecisionInput({
      outcome: 'customer_liable',
      liableAmountMajor: '125.50',
      reason: '  Customer accepted   documented panel damage. ',
    }, 'USD', 15000n),
    {
      outcome: 'CUSTOMER_LIABLE',
      currency: 'USD',
      liableAmountMinor: 12550n,
      reason: 'Customer accepted documented panel damage.',
    },
  );

  assert.throws(
    () => normalizeRentalDamageLiabilityDecisionInput({
      outcome: 'CUSTOMER_LIABLE',
      liableAmountMajor: '150.01',
      reason: 'Damage decision',
    }, 'USD', 15000n),
    /cannot exceed the retained repair-cost estimate/,
  );

  assert.throws(
    () => normalizeRentalDamageLiabilityDecisionInput({
      outcome: 'CUSTOMER_LIABLE',
      liableAmountMajor: '0',
      reason: 'Damage decision',
    }, 'USD', 15000n),
    /greater than zero/,
  );
});

test('no-liability decisions retain a reason and reject an amount', () => {
  assert.deepEqual(
    normalizeRentalDamageLiabilityDecisionInput({
      outcome: 'NO_CUSTOMER_LIABILITY',
      liableAmountMajor: '',
      reason: '  Normal wear and tear  ',
    }, 'USD', 15000n),
    {
      outcome: 'NO_CUSTOMER_LIABILITY',
      currency: 'USD',
      liableAmountMinor: null,
      reason: 'Normal wear and tear',
    },
  );

  assert.throws(
    () => normalizeRentalDamageLiabilityDecisionInput({
      outcome: 'NO_CUSTOMER_LIABILITY',
      liableAmountMajor: '1.00',
      reason: 'No customer liability',
    }, 'USD', 15000n),
    /must be blank/,
  );
});

test('liability decisions fail closed on invalid outcomes, reasons, or retained estimates', () => {
  assert.throws(
    () => normalizeRentalDamageLiabilityDecisionInput({
      outcome: 'PARTIAL',
      liableAmountMajor: '1.00',
      reason: 'Invalid outcome',
    }, 'USD', 15000n),
    RentalInventoryValidationError,
  );
  assert.throws(
    () => normalizeRentalDamageLiabilityDecisionInput({
      outcome: 'NO_CUSTOMER_LIABILITY',
      liableAmountMajor: '',
      reason: '   ',
    }, 'USD', 15000n),
    RentalInventoryValidationError,
  );
  assert.throws(
    () => normalizeRentalDamageLiabilityDecisionInput({
      outcome: 'NO_CUSTOMER_LIABILITY',
      liableAmountMajor: '',
      reason: 'No liability',
    }, 'USD', -1n),
    /repair estimate is invalid/,
  );
});
