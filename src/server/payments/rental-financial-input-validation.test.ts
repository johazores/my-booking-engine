import assert from 'node:assert/strict';
import test from 'node:test';

import { PricingValidationError } from '../pricing/money.ts';
import { TenantIdentifierValidationError } from '../tenancy/tenant-scope.ts';
import { isRentalFinancialInputValidationError } from './rental-financial-input-validation.ts';
import { PaymentInputValidationError } from './payment-provider.ts';

test('recognizes only application-owned rental financial input errors', () => {
  assert.equal(isRentalFinancialInputValidationError(new PaymentInputValidationError('Reference required.')), true);
  assert.equal(isRentalFinancialInputValidationError(new PricingValidationError('Invalid amount.')), true);
  assert.equal(isRentalFinancialInputValidationError(new TenantIdentifierValidationError('Invalid booking ID.')), true);
});

test('rejects arbitrary messages and structural lookalikes', () => {
  for (const error of [
    new Error('invalid required amount must be provided'),
    new Error('reference must be valid'),
    { name: 'PaymentInputValidationError', message: 'required reference' },
    { name: 'PricingValidationError', message: 'invalid amount' },
    null,
    undefined,
    'invalid reference',
  ]) {
    assert.equal(isRentalFinancialInputValidationError(error), false);
  }
});
