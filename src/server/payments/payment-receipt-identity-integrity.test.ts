import assert from 'node:assert/strict';
import test from 'node:test';
import { PaymentReceiptEvidenceError, sanitizeSuccessfulPaymentTransactions } from './payment-receipt-domain.ts';

function payment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'first', kind: 'CAPTURE' as const, status: 'SUCCEEDED',
    providerCode: 'stripe', providerReference: 'pi_first',
    sourceProviderReference: null, currency: 'AUD',
    amountMinor: 11000n, createdAt: new Date('2026-10-01T00:00:00Z'),
    ...overrides,
  };
}

test('authorization fallback and captured authorization share the same refund source', () => {
  const authorization = payment({ kind: 'AUTHORIZATION' });
  const refund = payment({ id: 'refund', kind: 'REFUND', providerReference: 're_1', sourceProviderReference: 'pi_first', amountMinor: 1000n });
  assert.doesNotThrow(() => sanitizeSuccessfulPaymentTransactions([authorization, refund], 'AUD'));
  assert.doesNotThrow(() => sanitizeSuccessfulPaymentTransactions([authorization, payment({ id: 'capture' }), refund], 'AUD'));
  assert.throws(() => sanitizeSuccessfulPaymentTransactions([authorization, payment({ id: 'capture', providerReference: 'pi_other' }), refund], 'AUD'), PaymentReceiptEvidenceError);
});

test('invalid successful payment money and provider identity fail closed', () => {
  for (const invalid of [
    { amountMinor: '11000' }, { kind: 'OTHER' },
    { id: '' }, { createdAt: new Date('invalid') },
    { providerReference: ' sf_claim_pending' },
    { providerReference: ' pi_first' }, { providerCode: ' stripe' },
    { sourceProviderReference: 'pi_first' },
  ]) {
    assert.throws(() => sanitizeSuccessfulPaymentTransactions([payment(invalid)], 'AUD'), PaymentReceiptEvidenceError);
  }
  assert.throws(() => sanitizeSuccessfulPaymentTransactions([
    payment(), payment({ providerReference: 'pi_second' }),
  ], 'AUD'), PaymentReceiptEvidenceError);
});
