import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DATABASE_URL ??= 'postgresql://sf_unit_test:sf_unit_test@127.0.0.1:5432/sf_unit_test';

const { paymentApiError, paymentJson } = await import('./payment-http.ts');
const { PaymentProviderError } = await import('./payment-provider.ts');

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
  const response = paymentJson({ providerCode: 'stripe', providerReference: 'pi_real123' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { providerCode: 'stripe', providerReference: 'pi_real123' });
});

test('paymentApiError exposes normalized retryability without forwarding raw provider messages', async () => {
  const response = paymentApiError(new PaymentProviderError(
    'PROVIDER_UNAVAILABLE',
    'Stripe upstream said request req_secret_provider_reference could not be reached.',
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
    'Provider raw decline detail with pi_sensitive_reference.',
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
