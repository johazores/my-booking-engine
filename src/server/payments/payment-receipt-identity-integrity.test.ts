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


test('receipt provider identities reject C0/C1 controls without excluding legitimate Unicode', () => {
  const codes = [...Array.from({ length: 32 }, (_, code) => code), ...Array.from({ length: 33 }, (_, index) => index + 127)];
  for (const code of codes) {
    const control = String.fromCharCode(code);
    for (const invalid of [
      { providerCode: `stri${control}pe` },
      { providerReference: `pi${control}first` },
    ]) {
      assert.throws(() => sanitizeSuccessfulPaymentTransactions([payment(invalid)], 'AUD'), {
        name: 'PaymentReceiptEvidenceError',
        message: 'Successful payment activity is missing verified provider identity.',
      });
    }
    assert.throws(() => sanitizeSuccessfulPaymentTransactions([
      payment(), payment({ id: 'refund', kind: 'REFUND', providerReference: 're_1',
        sourceProviderReference: `pi${control}first`, amountMinor: 1000n }),
    ], 'AUD'), {
      name: 'PaymentReceiptEvidenceError',
      message: 'Successful payment activity has an invalid refund source reference.',
    });
  }
  assert.doesNotThrow(() => sanitizeSuccessfulPaymentTransactions([
    payment({ providerReference: 'pi_é日本語' }),
  ], 'AUD'));
});
