import assert from 'node:assert/strict';
import test from 'node:test';

import { ManualPaymentProvider, normalizeManualPaymentReference } from './manual-payment-provider.ts';
import {
  PaymentProviderError,
  assertPaymentProviderCapability,
  normalizePaymentIdempotencyKey,
  normalizePaymentMoney,
  normalizePaymentOperationContext,
} from './payment-provider.ts';

const organizationId = '11111111-1111-4111-8111-111111111111';
const bookingId = '22222222-2222-4222-8222-222222222222';

test('normalizes exact payment money and tenant-owned operation identifiers', () => {
  const context = normalizePaymentOperationContext({
    organizationId: ` ${organizationId.toUpperCase()} `,
    bookingId: ` ${bookingId.toUpperCase()} `,
    idempotencyKey: 'payment:booking-1',
    currency: ' usd ',
    amountMinor: '24100',
  });

  assert.equal(context.organizationId, organizationId);
  assert.equal(context.bookingId, bookingId);
  assert.equal(context.idempotencyKey, 'payment:booking-1');
  assert.deepEqual(context.money, { currency: 'USD', amountMinor: 24100n });
  assert.equal(Object.isFrozen(context), true);
  assert.equal(Object.isFrozen(context.money), true);
});

test('rejects malformed payment money and idempotency inputs', () => {
  assert.throws(() => normalizePaymentMoney('US', 100n), /three-letter ISO currency code/);
  assert.throws(() => normalizePaymentMoney('USD', -1n), /non-negative integer minor-unit/);
  assert.throws(() => normalizePaymentMoney('USD', '1.00'), /non-negative integer minor-unit/);
  assert.throws(() => normalizePaymentMoney('USD', 100), /non-negative integer minor-unit/);
  assert.throws(() => normalizePaymentIdempotencyKey('short'), /8-120/);
  assert.throws(() => normalizePaymentIdempotencyKey('payment key'), /8-120/);
  assert.throws(() => normalizePaymentOperationContext({ organizationId: 'tenant', bookingId, idempotencyKey: 'payment:booking-1', currency: 'USD', amountMinor: '1' }), /Organization ID must be a valid UUID/);
});

test('manual payment adapter advertises only offline recording and preserves exact amount', async () => {
  const provider = new ManualPaymentProvider();
  assert.deepEqual([...provider.capabilities], ['OFFLINE_RECORDING']);
  assert.doesNotThrow(() => assertPaymentProviderCapability(provider, 'OFFLINE_RECORDING'));
  assert.throws(() => assertPaymentProviderCapability(provider, 'AUTHORIZE'), (error: unknown) => {
    assert.equal(error instanceof PaymentProviderError, true);
    assert.equal((error as PaymentProviderError).code, 'UNSUPPORTED_OPERATION');
    return true;
  });

  const result = await provider.recordOfflinePayment({
    organizationId,
    bookingId,
    idempotencyKey: 'payment:booking-1',
    money: { currency: 'USD', amountMinor: 24100n },
    reference: ' Bank transfer #ABC-123 ',
  });

  assert.deepEqual(result, {
    providerCode: 'manual',
    providerReference: 'Bank transfer #ABC-123',
    status: 'PAID',
    money: { currency: 'USD', amountMinor: 24100n },
  });
});

test('manual payment references are bounded and intentionally exclude arbitrary control characters', () => {
  assert.equal(normalizeManualPaymentReference('Cash receipt 123'), 'Cash receipt 123');
  assert.throws(() => normalizeManualPaymentReference(''), /required|1-120/);
  assert.throws(() => normalizeManualPaymentReference('bad\nreference'), /safe printable/);
  assert.throws(() => normalizeManualPaymentReference('x'.repeat(121)), /safe printable/);
});
