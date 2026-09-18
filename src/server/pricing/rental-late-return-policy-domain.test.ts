import assert from 'node:assert/strict';
import test from 'node:test';

import { RentalInventoryValidationError } from '../inventory/rental-domain.ts';
import {
  normalizeRentalLateReturnPolicyInput,
  rentalLateReturnPolicyMatches,
} from './rental-late-return-policy-domain.ts';

test('enabled late-return policy derives exact positive minor-unit fee and bounded grace', () => {
  assert.deepEqual(normalizeRentalLateReturnPolicyInput({
    mode: 'enable',
    graceDays: '2',
    dailyFeeAmountMajor: '125.50',
    reason: '  Standard   fleet late fee. ',
    expectedVersion: '4',
  }, 'PHP'), {
    mode: 'ENABLE',
    enabled: true,
    graceDays: 2,
    dailyFeeMinor: 12550n,
    currency: 'PHP',
    reason: 'Standard fleet late fee.',
    expectedVersion: 4,
  });

  assert.throws(() => normalizeRentalLateReturnPolicyInput({
    mode: 'ENABLE',
    graceDays: '31',
    dailyFeeAmountMajor: '1.00',
    reason: 'Invalid grace',
    expectedVersion: '0',
  }, 'USD'), RentalInventoryValidationError);

  assert.throws(() => normalizeRentalLateReturnPolicyInput({
    mode: 'ENABLE',
    graceDays: '0',
    dailyFeeAmountMajor: '0',
    reason: 'Invalid fee',
    expectedVersion: '0',
  }, 'USD'), /greater than zero/);
});

test('disabled policy is an explicit append-only revision without fee authority', () => {
  assert.deepEqual(normalizeRentalLateReturnPolicyInput({
    mode: 'DISABLE',
    graceDays: '999',
    dailyFeeAmountMajor: '999.00',
    reason: ' Policy retired. ',
    expectedVersion: '7',
  }, 'AUD'), {
    mode: 'DISABLE',
    enabled: false,
    graceDays: 0,
    dailyFeeMinor: null,
    currency: 'AUD',
    reason: 'Policy retired.',
    expectedVersion: 7,
  });
});

test('policy equivalence includes reason and exact commercial values', () => {
  const policy = {
    enabled: true,
    graceDays: 1,
    dailyFeeMinor: 2500n,
    currency: 'USD',
    reason: 'Standard',
  };
  assert.equal(rentalLateReturnPolicyMatches(policy, { ...policy }), true);
  assert.equal(rentalLateReturnPolicyMatches(policy, { ...policy, dailyFeeMinor: 2600n }), false);
  assert.equal(rentalLateReturnPolicyMatches(policy, { ...policy, reason: 'Changed' }), false);
});
