import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DATABASE_URL ??= 'postgresql://sf_unit_test:sf_unit_test@127.0.0.1:5432/sf_unit_test';

const {
  PAYMENT_REQUEST_MAX_BYTES,
  paymentApiError,
  paymentJson,
  readPaymentJsonObject,
} = await import('./payment-http.ts');
const { PaymentProviderError } = await import('./payment-provider.ts');

test('readPaymentJsonObject accepts a JSON object with an application/json media type', async () => {
  const request = new Request('https://sf.example.test/api/payments/manual', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ bookingId: 'booking-1', amountMinor: 1200 }),
  });

  assert.deepEqual(await readPaymentJsonObject(request), { bookingId: 'booking-1', amountMinor: 1200 });
});

test('readPaymentJsonObject rejects unsupported media types and non-object JSON bodies', async () => {
  const wrongMediaType = new Request('https://sf.example.test/api/payments/manual', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: '{}',
  });
  const arrayBody = new Request('https://sf.example.test/api/payments/manual', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '[]',
  });

  await assert.rejects(() => readPaymentJsonObject(wrongMediaType), { name: 'PaymentApiPayloadError' });
  await assert.rejects(() => readPaymentJsonObject(arrayBody), { name: 'PaymentApiPayloadError' });
});

test('readPaymentJsonObject enforces advertised and streamed byte limits', async () => {
  const advertisedTooLarge = new Request('https://sf.example.test/api/payments/manual', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': String(PAYMENT_REQUEST_MAX_BYTES + 1),
    },
    body: '{}',
  });
  const streamedTooLarge = new Request('https://sf.example.test/api/payments/manual', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value: 'a'.repeat(PAYMENT_REQUEST_MAX_BYTES) }),
  });

  await assert.rejects(() => readPaymentJsonObject(advertisedTooLarge), { name: 'PaymentApiPayloadError' });
  await assert.rejects(() => readPaymentJsonObject(streamedTooLarge), { name: 'PaymentApiPayloadError' });
});

test('readPaymentJsonObject rejects invalid UTF-8 before JSON parsing', async () => {
  const request = new Request('https://sf.example.test/api/payments/manual', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xff, 0x7d]),
  });

  await assert.rejects(() => readPaymentJsonObject(request), { name: 'PaymentApiPayloadError' });
});

test('readPaymentJsonObject rejects missing, malformed, scalar, and null JSON bodies', async () => {
  const requests = [
    new Request('https://sf.example.test/api/payments/manual', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    }),
    new Request('https://sf.example.test/api/payments/manual', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"bookingId":',
    }),
    new Request('https://sf.example.test/api/payments/manual', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '"booking-1"',
    }),
    new Request('https://sf.example.test/api/payments/manual', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'null',
    }),
  ];

  for (const request of requests) {
    await assert.rejects(() => readPaymentJsonObject(request), { name: 'PaymentApiPayloadError' });
  }
});

test('readPaymentJsonObject honors exact byte limits and rejects invalid length metadata or limits', async () => {
  const exactBody = '{"ok":true}';
  const exactBytes = new TextEncoder().encode(exactBody).byteLength;
  const exact = new Request('https://sf.example.test/api/payments/manual', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: exactBody,
  });
  assert.deepEqual(await readPaymentJsonObject(exact, exactBytes), { ok: true });

  const tooSmall = new Request('https://sf.example.test/api/payments/manual', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: exactBody,
  });
  await assert.rejects(
    () => readPaymentJsonObject(tooSmall, exactBytes - 1),
    { name: 'PaymentApiPayloadError' },
  );

  const invalidLength = new Request('https://sf.example.test/api/payments/manual', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': 'not-a-number',
    },
    body: '{}',
  });
  await assert.rejects(
    () => readPaymentJsonObject(invalidLength),
    { name: 'PaymentApiPayloadError' },
  );

  const invalidLimit = new Request('https://sf.example.test/api/payments/manual', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  await assert.rejects(
    () => readPaymentJsonObject(invalidLimit, 0),
    { name: 'PaymentApiPayloadError' },
  );
});

test('paymentJson never exposes internal provider-call claim references', async () => {
  const response = paymentJson({
    providerCode: 'stripe',
    providerReference: `sf_claim_${'a'.repeat(64)}`,
    amountMinor: 1200n,
  });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), {
    providerCode: 'stripe',
    providerReference: null,
    amountMinor: '1200',
  });
});

test('paymentJson preserves real provider references for authorized staff without allowing response caching', async () => {
  const response = paymentJson({ providerCode: 'stripe', providerReference: 'provider-reference-123' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { providerCode: 'stripe', providerReference: 'provider-reference-123' });
});

test('paymentApiError exposes normalized retryability without forwarding raw provider messages', async () => {
  const response = paymentApiError(new PaymentProviderError(
    'PROVIDER_UNAVAILABLE',
    'Raw upstream diagnostic that must not be forwarded.',
    true,
  ));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), {
    error: 'provider-error',
    code: 'PROVIDER_UNAVAILABLE',
    retryable: true,
    message: 'Payment provider is temporarily unavailable. Try again.',
  });
});

test('paymentApiError keeps definitive provider failure identity while sanitizing presentation', async () => {
  const response = paymentApiError(new PaymentProviderError(
    'DECLINED',
    'Raw decline diagnostic that must not be forwarded.',
    false,
  ));
  assert.equal(response.status, 502);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), {
    error: 'provider-error',
    code: 'DECLINED',
    retryable: false,
    message: 'Payment provider declined the operation.',
  });
});

test('paymentApiError does not grant provider presentation authority to structural lookalikes', async () => {
  const lookalike = Object.create(PaymentProviderError.prototype) as Record<string, unknown>;
  Object.defineProperties(lookalike, {
    code: { value: 'PROVIDER_UNAVAILABLE', enumerable: true },
    retryable: { value: true, enumerable: true },
    message: { value: 'forged provider failure', enumerable: true },
  });

  const response = paymentApiError(lookalike);
  assert.equal(response.status, 500);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { error: 'internal-error' });
});
