import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const receiptUi = await readFile(
  new URL('../app/book/[organization-slug]/public-booking-receipt.tsx', import.meta.url),
  'utf8',
);

test('public payment receipt has recoverable loading and retry states', () => {
  assert.match(receiptUi, /Payment receipt could not be verified right now/);
  assert.match(receiptUi, /Payment receipt could not be loaded right now/);
  assert.match(receiptUi, /role="status"/);
  assert.match(receiptUi, /role="alert"/);
  assert.match(receiptUi, /Try again/);
  assert.doesNotMatch(receiptUi, /setReceipt\(null\)/);
});
