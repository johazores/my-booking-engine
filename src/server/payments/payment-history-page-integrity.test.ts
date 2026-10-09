import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePaymentHistoryPage } from './payment-history-page-integrity.ts';

test('accepts empty, increasing, and exact-size pages', () => {
  assert.equal(validatePaymentHistoryPage([], undefined, 2), null);
  assert.equal(validatePaymentHistoryPage([{ id: 'a' }, { id: 'b' }], undefined, 2), null);
  assert.equal(validatePaymentHistoryPage([{ id: 'c' }], 'b', 2), null);
});
test('rejects duplicates within and across pages', () => {
  assert.equal(validatePaymentHistoryPage([{ id: 'a' }, { id: 'a' }], undefined, 2), 'id-order');
  assert.equal(validatePaymentHistoryPage([{ id: 'b' }], 'b', 2), 'id-order');
});
test('rejects regressing and invalid transaction IDs', () => {
  assert.equal(validatePaymentHistoryPage([{ id: 'b' }, { id: 'a' }], undefined, 2), 'id-order');
  assert.equal(validatePaymentHistoryPage([{ id: 'a' }], 'b', 2), 'id-order');
  assert.equal(validatePaymentHistoryPage([{ id: '' }], undefined, 2), 'id-order');
  assert.equal(validatePaymentHistoryPage([{ id: null } as never], undefined, 2), 'id-order');
});
test('rejects overfull pages', () => {
  assert.equal(validatePaymentHistoryPage([{ id: 'a' }, { id: 'b' }, { id: 'c' }], undefined, 2), 'page-size');
});
