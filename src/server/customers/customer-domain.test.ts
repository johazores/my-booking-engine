import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CustomerValidationError,
  DEIDENTIFIED_CUSTOMER_FIRST_NAME,
  DEIDENTIFIED_CUSTOMER_LAST_NAME,
  assertCustomerArchiveConfirmation,
  assertCustomerDeidentificationConfirmation,
  normalizeCustomerInput,
  normalizeCustomerSearch,
  parseCustomerPage,
  parseCustomerPageSize,
  parseCustomerSort,
  parseCustomerStatus,
} from './customer-domain.ts';

test('normalizes customer identity and optional contact data', () => {
  const result = normalizeCustomerInput({
    firstName: '  Ana   Maria ',
    lastName: ' Santos ',
    email: ' ANA@EXAMPLE.COM ',
    phone: ' +63   917 555 0100 ',
    notes: ' Prefers email. ',
  });
  assert.deepEqual(result, {
    firstName: 'Ana Maria',
    lastName: 'Santos',
    email: 'ana@example.com',
    phone: '+63 917 555 0100',
    notes: 'Prefers email.',
  });
});

test('allows optional customer contact fields to remain empty', () => {
  const result = normalizeCustomerInput({ firstName: 'Ana', lastName: 'Santos', email: '', phone: '', notes: '' });
  assert.equal(result.email, null);
  assert.equal(result.phone, null);
  assert.equal(result.notes, null);
});

test('rejects invalid customer fields and lifecycle confirmations', () => {
  assert.throws(() => normalizeCustomerInput({ firstName: '', lastName: 'Santos', email: '', phone: '', notes: '' }), CustomerValidationError);
  assert.throws(() => normalizeCustomerInput({ firstName: 'Ana', lastName: 'Santos', email: 'bad-email', phone: '', notes: '' }), CustomerValidationError);
  assert.throws(() => normalizeCustomerInput({ firstName: 'Ana', lastName: 'Santos', email: '', phone: 'x', notes: '' }), CustomerValidationError);
  assert.throws(() => assertCustomerArchiveConfirmation('delete'), CustomerValidationError);
  assert.throws(() => assertCustomerDeidentificationConfirmation('archive'), CustomerValidationError);
  assert.doesNotThrow(() => assertCustomerArchiveConfirmation(' archive '));
  assert.doesNotThrow(() => assertCustomerDeidentificationConfirmation(' deidentify '));
});

test('uses non-identifying bounded customer profile replacements', () => {
  assert.equal(DEIDENTIFIED_CUSTOMER_FIRST_NAME, 'De-identified');
  assert.equal(DEIDENTIFIED_CUSTOMER_LAST_NAME, 'Customer');
  assert.ok(DEIDENTIFIED_CUSTOMER_FIRST_NAME.length <= 80);
  assert.ok(DEIDENTIFIED_CUSTOMER_LAST_NAME.length <= 80);
});

test('parses bounded list query values defensively', () => {
  assert.equal(normalizeCustomerSearch('  Ana   Santos  '), 'Ana Santos');
  assert.equal(parseCustomerStatus('ALL'), 'ALL');
  assert.equal(parseCustomerStatus('anything'), 'ACTIVE');
  assert.equal(parseCustomerSort('name-desc'), 'name-desc');
  assert.equal(parseCustomerSort('random'), 'newest');
  assert.equal(parseCustomerPage('-1'), 1);
  assert.equal(parseCustomerPage('3'), 3);
  assert.equal(parseCustomerPageSize('999'), 50);
  assert.equal(parseCustomerPageSize('0'), 20);
});
