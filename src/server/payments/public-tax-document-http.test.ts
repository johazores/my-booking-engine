import assert from 'node:assert/strict';
import test from 'node:test';

import { readPublicTaxDocumentBookingCapability } from './public-tax-document-http.ts';

function request(body: string) {
  return new Request('https://sf.example.test/public-tax-document', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

test('returns only the booking capability string from a valid JSON object', async () => {
  const capability = await readPublicTaxDocumentBookingCapability(request(JSON.stringify({
    bookingCapability: 'capability-value',
    ignored: 'not-authority',
  })));
  assert.equal(capability, 'capability-value');
});

test('rejects malformed JSON and unsupported body shapes without throwing', async () => {
  assert.equal(await readPublicTaxDocumentBookingCapability(request('{')), null);
  assert.equal(await readPublicTaxDocumentBookingCapability(request('null')), null);
  assert.equal(await readPublicTaxDocumentBookingCapability(request('[]')), null);
  assert.equal(await readPublicTaxDocumentBookingCapability(request(JSON.stringify({ bookingCapability: 123 }))), null);
});
