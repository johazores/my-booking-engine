import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DATABASE_URL ??= 'postgresql://sf_unit_test:sf_unit_test@127.0.0.1:5432/sf_unit_test';

const { paymentJson } = await import('./payment-http.ts');

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
