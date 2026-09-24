import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HospitalityFrozenCancellationRefundAuthorityError,
  validateHospitalityFrozenCancellationRefundAuthorities,
} from './hospitality-cancellation-after-amendment-frozen-refund-authority-domain.ts';

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const BOOKING_ID = '22222222-2222-4222-8222-222222222222';
const REFUND_ID = '33333333-3333-4333-8333-333333333333';

const frozen = Object.freeze([Object.freeze({
  refundTransactionId: REFUND_ID,
  refundOrdinal: '1',
  amountMinor: '11000',
  createdAt: '2026-09-20T10:00:00.000Z',
})]);

function current(status: string) {
  return Object.freeze([Object.freeze({
    id: REFUND_ID,
    organizationId: ORGANIZATION_ID,
    bookingId: BOOKING_ID,
    commercialAmendmentId: null,
    kind: 'REFUND',
    status,
    providerCode: 'stripe',
    providerReference: 're_123',
    sourceProviderReference: 'pi_123',
    currency: 'AUD',
    amountMinor: 11_000n,
    createdAt: new Date('2026-09-20T10:00:00.000Z'),
  })]);
}

function input(status: string) {
  return {
    organizationId: ORGANIZATION_ID,
    bookingId: BOOKING_ID,
    predecessorIssuedAt: new Date('2026-09-19T10:00:00.000Z'),
    issuedAt: new Date('2026-09-20T11:00:00.000Z'),
    expectedTotalMinor: 11_000n,
    frozen,
    current: current(status),
  };
}

test('current provider lifecycle status does not rewrite frozen historical refund authority', () => {
  for (const status of ['SUCCEEDED', 'FAILED', 'PENDING', 'AMBIGUOUS']) {
    const result = validateHospitalityFrozenCancellationRefundAuthorities(input(status));
    assert.equal(result.refundCount, 1);
    assert.equal(result.refundTotalMinor, 11_000n);
  }
});

test('structural refund evidence still fails closed', () => {
  const cases = [
    { current: [{ ...current('FAILED')[0]!, organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }] },
    { current: [{ ...current('FAILED')[0]!, bookingId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }] },
    { current: [{ ...current('FAILED')[0]!, commercialAmendmentId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }] },
    { current: [{ ...current('FAILED')[0]!, kind: 'CAPTURE' }] },
    { current: [{ ...current('FAILED')[0]!, currency: 'USD' }] },
    { current: [{ ...current('FAILED')[0]!, amountMinor: 10_000n }] },
    { current: [{ ...current('FAILED')[0]!, sourceProviderReference: null }] },
    { current: [{ ...current('FAILED')[0]!, createdAt: new Date('2026-09-20T10:00:01.000Z') }] },
  ];

  for (const overrides of cases) {
    assert.throws(
      () => validateHospitalityFrozenCancellationRefundAuthorities({ ...input('FAILED'), ...overrides }),
      HospitalityFrozenCancellationRefundAuthorityError,
    );
  }
});

test('missing, duplicate, misordered, and incorrect-total authority fails closed', () => {
  assert.throws(
    () => validateHospitalityFrozenCancellationRefundAuthorities({ ...input('FAILED'), current: [] }),
    HospitalityFrozenCancellationRefundAuthorityError,
  );
  assert.throws(
    () => validateHospitalityFrozenCancellationRefundAuthorities({
      ...input('FAILED'),
      frozen: Object.freeze([...frozen, frozen[0]!]),
      current: Object.freeze([...current('FAILED'), current('FAILED')[0]!]),
    }),
    HospitalityFrozenCancellationRefundAuthorityError,
  );
  assert.throws(
    () => validateHospitalityFrozenCancellationRefundAuthorities({
      ...input('FAILED'),
      frozen: Object.freeze([Object.freeze({ ...frozen[0]!, refundOrdinal: '2' })]),
    }),
    HospitalityFrozenCancellationRefundAuthorityError,
  );
  assert.throws(
    () => validateHospitalityFrozenCancellationRefundAuthorities({ ...input('FAILED'), expectedTotalMinor: 10_000n }),
    HospitalityFrozenCancellationRefundAuthorityError,
  );
});
