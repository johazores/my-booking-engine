import assert from 'node:assert/strict';
import test from 'node:test';
import { readHospitalityPaymentReceiptHistory } from './hospitality-payment-receipt-history.ts';

test('receipt history selects refund-source attribution', async () => {
  const row = {
    id: 'a', organizationId: 'org', bookingId: 'booking',
    kind: 'CAPTURE', status: 'SUCCEEDED',
    providerCode: 'stripe', providerReference: 'pi',
    sourceProviderReference: null, currency: 'AUD',
    amountMinor: 100n, createdAt: new Date(),
  };
  let selected = false;
  const transaction = { paymentTransaction: { async findMany(args: { select: Record<string, boolean> }) {
    selected = args.select.sourceProviderReference === true;
    return [row];
  } } };
  const result = await readHospitalityPaymentReceiptHistory({
    transaction: transaction as never, organizationId: 'org', bookingId: 'booking',
  });
  assert.equal(selected, true);
  assert.equal(result.complete, true);
});
