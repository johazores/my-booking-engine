import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

function source(path) {
  return fs.readFileSync(path, 'utf8');
}

test('Travelport receipt types cannot hide contradictory reservation branches', () => {
  const helper = source('src/server/suppliers/travelport-stays-reservation-receipt-evidence.ts');
  const retrieve = source('src/server/suppliers/travelport-stays-reservation-response.ts');

  assert.match(helper, /const hasConfirmationBranch = receipt\.Confirmation !== undefined;/);
  assert.match(helper, /const hasCancellationBranch = receipt\.Cancellation !== undefined;/);
  assert.match(helper, /hasConfirmationBranch && hasCancellationBranch/);
  assert.match(helper, /receiptType === 'ReceiptPayment'[\s\S]*hasConfirmationBranch \|\| hasCancellationBranch/);
  assert.match(helper, /receiptType === 'ReceiptCancellation'[\s\S]*hasConfirmationBranch/);
  assert.match(helper, /receiptType !== 'ReceiptConfirmation' \|\| hasCancellationBranch/);
  assert.match(
    retrieve,
    /function isDocumentedPassivePlaceholderReceipt[\s\S]*receipt\.Cancellation !== undefined[\s\S]*confirmation\.Locator !== undefined/,
  );
  assert.doesNotMatch(helper, /CardNumber|SeriesCode|PaymentCard|FormOfPayment/);
});
