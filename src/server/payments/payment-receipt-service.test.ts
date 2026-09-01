import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPaymentReceiptNumber, summarizeSuccessfulPaymentActivity } from './payment-receipt-service.ts';

test('buildPaymentReceiptNumber is deterministic and removes UUID separators', () => {
  assert.equal(
    buildPaymentReceiptNumber('123e4567-e89b-12d3-a456-426614174000'),
    'SF-123E4567E89B12D3',
  );
});

test('summarizeSuccessfulPaymentActivity counts captured money and refunds but not authorization holds', () => {
  const transactions = [
    {
      id: '1',
      kind: 'AUTHORIZATION' as const,
      status: 'SUCCEEDED' as const,
      providerCode: 'stripe',
      providerReference: 'pi_auth',
      currency: 'USD',
      amountMinor: 10000n,
      createdAt: new Date('2026-09-01T00:00:00Z'),
    },
    {
      id: '2',
      kind: 'CAPTURE' as const,
      status: 'SUCCEEDED' as const,
      providerCode: 'stripe',
      providerReference: 'pi_capture',
      currency: 'USD',
      amountMinor: 10000n,
      createdAt: new Date('2026-09-01T00:01:00Z'),
    },
    {
      id: '3',
      kind: 'REFUND' as const,
      status: 'SUCCEEDED' as const,
      providerCode: 'stripe',
      providerReference: 're_partial',
      currency: 'USD',
      amountMinor: 2500n,
      createdAt: new Date('2026-09-01T00:02:00Z'),
    },
  ];

  assert.deepEqual(summarizeSuccessfulPaymentActivity(transactions), {
    capturedMinor: 10000n,
    refundedMinor: 2500n,
    netPaidMinor: 7500n,
  });
});

test('summarizeSuccessfulPaymentActivity includes real offline payments', () => {
  const transactions = [{
    id: '1',
    kind: 'OFFLINE_PAYMENT' as const,
    status: 'SUCCEEDED' as const,
    providerCode: 'manual',
    providerReference: 'bank-123',
    currency: 'PHP',
    amountMinor: 5000n,
    createdAt: new Date('2026-09-01T00:00:00Z'),
  }];

  assert.deepEqual(summarizeSuccessfulPaymentActivity(transactions), {
    capturedMinor: 5000n,
    refundedMinor: 0n,
    netPaidMinor: 5000n,
  });
});

test('settled booking may use a successful authorization as capture proof only when no capture row exists', () => {
  const authorization = {
    id: '1',
    kind: 'AUTHORIZATION' as const,
    status: 'SUCCEEDED' as const,
    providerCode: 'stripe',
    providerReference: 'pi_direct',
    currency: 'USD',
    amountMinor: 10000n,
    createdAt: new Date('2026-09-01T00:00:00Z'),
  };

  assert.deepEqual(summarizeSuccessfulPaymentActivity([authorization], 'PAID'), {
    capturedMinor: 10000n,
    refundedMinor: 0n,
    netPaidMinor: 10000n,
  });
  assert.deepEqual(summarizeSuccessfulPaymentActivity([authorization], 'AUTHORIZED'), {
    capturedMinor: 0n,
    refundedMinor: 0n,
    netPaidMinor: 0n,
  });
});

test('refunded bookings retain direct-settlement authorization as the captured basis', () => {
  const authorization = {
    id: '1',
    kind: 'AUTHORIZATION' as const,
    status: 'SUCCEEDED' as const,
    providerCode: 'stripe',
    providerReference: 'pi_direct',
    currency: 'USD',
    amountMinor: 10000n,
    createdAt: new Date('2026-09-01T00:00:00Z'),
  };
  const partialRefund = {
    id: '2',
    kind: 'REFUND' as const,
    status: 'SUCCEEDED' as const,
    providerCode: 'stripe',
    providerReference: 're_partial',
    currency: 'USD',
    amountMinor: 2500n,
    createdAt: new Date('2026-09-01T00:01:00Z'),
  };
  const finalRefund = {
    ...partialRefund,
    id: '3',
    providerReference: 're_final',
    amountMinor: 7500n,
    createdAt: new Date('2026-09-01T00:02:00Z'),
  };

  assert.deepEqual(summarizeSuccessfulPaymentActivity([authorization, partialRefund], 'PARTIALLY_REFUNDED'), {
    capturedMinor: 10000n,
    refundedMinor: 2500n,
    netPaidMinor: 7500n,
  });
  assert.deepEqual(summarizeSuccessfulPaymentActivity([authorization, partialRefund, finalRefund], 'REFUNDED'), {
    capturedMinor: 10000n,
    refundedMinor: 10000n,
    netPaidMinor: 0n,
  });
});
