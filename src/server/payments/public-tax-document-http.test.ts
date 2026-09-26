import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PUBLIC_TAX_DOCUMENT_CAPABILITY_MAX_CHARACTERS,
  PUBLIC_TAX_DOCUMENT_REQUEST_MAX_BYTES,
  readPublicTaxDocumentBookingCapability,
} from './public-tax-document-http.ts';

function request(body: BodyInit, contentType = 'application/json') {
  return new Request('https://sf.example.test/public-tax-document', {
    method: 'POST',
    headers: { 'content-type': contentType },
    body,
  });
}

test('returns only the booking capability string from a valid JSON object', async () => {
  const capability = await readPublicTaxDocumentBookingCapability(request(JSON.stringify({
    bookingCapability: 'capability-value',
    ignored: 'not-authority',
  }), 'application/json; charset=utf-8'));
  assert.equal(capability, 'capability-value');
});

test('rejects malformed JSON and unsupported body shapes without throwing', async () => {
  assert.equal(await readPublicTaxDocumentBookingCapability(request('{')), null);
  assert.equal(await readPublicTaxDocumentBookingCapability(request('null')), null);
  assert.equal(await readPublicTaxDocumentBookingCapability(request('[]')), null);
  assert.equal(await readPublicTaxDocumentBookingCapability(request(JSON.stringify({ bookingCapability: 123 }))), null);
});

test('rejects non-JSON media types before parsing capability authority', async () => {
  assert.equal(
    await readPublicTaxDocumentBookingCapability(request(JSON.stringify({ bookingCapability: 'capability-value' }), 'text/plain')),
    null,
  );
});

test('rejects advertised request sizes above the transport ceiling before body parsing', async () => {
  const oversizedLengthRequest = new Request('https://sf.example.test/public-tax-document', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': String(PUBLIC_TAX_DOCUMENT_REQUEST_MAX_BYTES + 1),
    },
    body: JSON.stringify({ bookingCapability: 'capability-value' }),
  });
  assert.equal(await readPublicTaxDocumentBookingCapability(oversizedLengthRequest), null);
});

test('rejects request bodies above the public tax-document transport ceiling', async () => {
  const oversized = JSON.stringify({
    bookingCapability: 'capability-value',
    ignored: 'x'.repeat(PUBLIC_TAX_DOCUMENT_REQUEST_MAX_BYTES),
  });
  assert.ok(Buffer.byteLength(oversized, 'utf8') > PUBLIC_TAX_DOCUMENT_REQUEST_MAX_BYTES);
  assert.equal(await readPublicTaxDocumentBookingCapability(request(oversized)), null);
});

test('rejects capability strings above their independent authority ceiling', async () => {
  const oversizedCapability = 'x'.repeat(PUBLIC_TAX_DOCUMENT_CAPABILITY_MAX_CHARACTERS + 1);
  const body = JSON.stringify({ bookingCapability: oversizedCapability });
  assert.ok(Buffer.byteLength(body, 'utf8') < PUBLIC_TAX_DOCUMENT_REQUEST_MAX_BYTES);
  assert.equal(await readPublicTaxDocumentBookingCapability(request(body)), null);
});

test('rejects invalid UTF-8 instead of decoding replacement characters into authority input', async () => {
  const invalidUtf8 = new Uint8Array([123, 34, 98, 111, 111, 107, 105, 110, 103, 67, 97, 112, 97, 98, 105, 108, 105, 116, 121, 34, 58, 34, 255, 34, 125]);
  assert.equal(await readPublicTaxDocumentBookingCapability(request(invalidUtf8)), null);
});
