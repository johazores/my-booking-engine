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
  assert.deepEqual(await response.json(), {
    providerCode: 'stripe',
    providerReference: null,
    amountMinor: '1200',
  });
});

test('paymentJson preserves real provider references', async () => {
  const response = paymentJson({ providerCode: 'stripe', providerReference: 'pi_real123' });
  assert.deepEqual(await response.json(), { providerCode: 'stripe', providerReference: 'pi_real123' });
});

test('paymentApiError exposes normalized retryability for recoverable provider failures', async () => {
  const response = paymentApiError(new PaymentProviderError('PROVIDER_UNAVAILABLE', 'Provider could not be reached.', true));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: 'provider-error',
    code: 'PROVIDER_UNAVAILABLE',
    retryable: true,
    message: 'Provider could not be reached.',
  });
});

test('paymentApiError marks definitive provider failures as non-retryable with the same request identity', async () => {
  const response = paymentApiError(new PaymentProviderError('DECLINED', 'Provider rejected the operation.', false));
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: 'provider-error',
    code: 'DECLINED',
    retryable: false,
    message: 'Provider rejected the operation.',
  });
});
