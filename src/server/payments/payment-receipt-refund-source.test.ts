import assert from 'node:assert/strict';
import test from 'node:test';
import { PaymentReceiptEvidenceError, sanitizeSuccessfulPaymentTransactions } from './payment-receipt-domain.ts';

function payment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'first',
    kind: 'CAPTURE' as const,
    status: 'SUCCEEDED',
    providerCode: 'stripe',
    providerReference: 'pi_first',
    sourceProviderReference: null,
    currency: 'AUD',
    amountMinor: 11000n,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    ...overrides,
  };
}

test('receipt requires valid refund source attribution', () => {
  const capture = payment();
  const refund = payment({ id: 'refund', kind: 'REFUND', providerReference: 're_1', sourceProviderReference: 'pi_first', amountMinor: 1000n });
  assert.doesNotThrow(() => sanitizeSuccessfulPaymentTransactions([capture, refund], 'AUD'));
  assert.throws(() => sanitizeSuccessfulPaymentTransactions([capture, { ...refund, sourceProviderReference: 'pi_missing' }], 'AUD'), PaymentReceiptEvidenceError);
  assert.throws(() => sanitizeSuccessfulPaymentTransactions([capture, { ...refund, providerCode: 'manual' }], 'AUD'), PaymentReceiptEvidenceError);
});

test('ambiguous or excessive source refunds cannot appear on a receipt', () => {
  const first = payment({ amountMinor: 2000n });
  const second = payment({ id: 'second', providerReference: 'pi_second', amountMinor: 9000n });
  const refund = payment({ id: 'refund', kind: 'REFUND', providerReference: 're_1', amountMinor: 1000n });
  assert.throws(() => sanitizeSuccessfulPaymentTransactions([first, second, refund], 'AUD'), PaymentReceiptEvidenceError);
  assert.doesNotThrow(() => sanitizeSuccessfulPaymentTransactions([first, second, { ...refund, sourceProviderReference: 'pi_first' }], 'AUD'));
  assert.throws(() => sanitizeSuccessfulPaymentTransactions([first, second, { ...refund, sourceProviderReference: 'pi_first', amountMinor: 2001n }], 'AUD'), PaymentReceiptEvidenceError);
});

test('refund source chronology rejects pre-settlement refunds for capture, offline, and direct authorization', () => {
  for (const kind of ['CAPTURE', 'OFFLINE_PAYMENT', 'AUTHORIZATION'] as const) {
    const source = payment({ kind, createdAt: new Date('2026-10-05T00:00:00Z') });
    const refund = payment({
      id: 'refund', kind: 'REFUND', providerReference: 're_early',
      sourceProviderReference: 'pi_first', amountMinor: 1000n,
      createdAt: new Date('2026-10-04T00:00:00Z'),
    });
    assert.throws(() => sanitizeSuccessfulPaymentTransactions([refund, source], 'AUD'), PaymentReceiptEvidenceError);
    assert.doesNotThrow(() => sanitizeSuccessfulPaymentTransactions([
      source, { ...refund, createdAt: new Date('2026-10-06T00:00:00Z') },
    ], 'AUD'));
    assert.doesNotThrow(() => sanitizeSuccessfulPaymentTransactions([
      source, { ...refund, createdAt: source.createdAt },
    ], 'AUD'));
  }
});
