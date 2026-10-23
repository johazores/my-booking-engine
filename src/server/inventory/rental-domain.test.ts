import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeRentalCurrency, RentalInventoryValidationError } from './rental-domain.ts';

test('rental currency configuration accepts supported currencies and rejects fabricated codes', () => {
  assert.equal(normalizeRentalCurrency(' php '), 'PHP');
  assert.equal(normalizeRentalCurrency('JPY'), 'JPY');
  for (const invalid of ['ZZZ', 'FOO', 'XXX', 'US']) {
    assert.throws(() => normalizeRentalCurrency(invalid), RentalInventoryValidationError);
  }
});
