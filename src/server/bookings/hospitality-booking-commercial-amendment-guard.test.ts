import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACTIVE_COMMERCIAL_AMENDMENT_CONFLICT_MESSAGE,
  COMMERCIAL_AMENDMENT_PAYMENT_RECOVERY_CONFLICT_MESSAGE,
  findActiveHospitalityBookingCommercialAmendment,
  hospitalityCommercialAmendmentPaymentActivityRequiresRecovery,
} from './hospitality-booking-commercial-amendment-guard.ts';

type GuardReader = Parameters<typeof findActiveHospitalityBookingCommercialAmendment>[0]['reader'];

function fakeReader({
  findAmendment,
  findPayment = async () => null,
}: {
  findAmendment: (args: unknown) => Promise<unknown>;
  findPayment?: (args: unknown) => Promise<unknown>;
}): GuardReader {
  return {
    hospitalityBookingCommercialAmendment: { findFirst: findAmendment },
    paymentTransaction: { findFirst: findPayment },
  } as unknown as GuardReader;
}

test('active commercial amendment lookup is tenant, booking, and status scoped without reading payments', async () => {
  let amendmentQuery: unknown;
  let paymentReads = 0;
  const row = {
    id: 'amendment-1',
    direction: 'ADDITIONAL_CHARGE',
    expiresAt: new Date('2026-09-03T03:15:00.000Z'),
  };
  const reader = fakeReader({
    findAmendment: async (args) => {
      amendmentQuery = args;
      return row;
    },
    findPayment: async () => {
      paymentReads += 1;
      return null;
    },
  });

  const result = await findActiveHospitalityBookingCommercialAmendment({
    reader,
    organizationId: 'organization-1',
    bookingId: 'booking-1',
    now: new Date('2026-09-03T03:00:00.000Z'),
  });

  assert.equal(result, row);
  assert.equal(paymentReads, 0);
  assert.deepEqual(amendmentQuery, {
    where: {
      organizationId: 'organization-1',
      bookingId: 'booking-1',
      status: 'PREPARED',
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, direction: true, expiresAt: true },
  });
});

test('expired amendment without payment activity is ignored using a bounded existence query', async () => {
  let paymentQuery: unknown;
  const reader = fakeReader({
    findAmendment: async () => ({
      id: 'amendment-1',
      direction: 'REFUND',
      expiresAt: new Date('2026-09-03T02:59:00.000Z'),
    }),
    findPayment: async (args) => {
      paymentQuery = args;
      return null;
    },
  });

  const result = await findActiveHospitalityBookingCommercialAmendment({
    reader,
    organizationId: 'organization-1',
    bookingId: 'booking-1',
    now: new Date('2026-09-03T03:00:00.000Z'),
  });

  assert.equal(result, null);
  assert.deepEqual(paymentQuery, {
    where: {
      organizationId: 'organization-1',
      bookingId: 'booking-1',
      commercialAmendmentId: 'amendment-1',
      status: { not: 'FAILED' },
    },
    select: { status: true },
  });
});

for (const status of ['PENDING', 'AMBIGUOUS', 'SUCCEEDED'] as const) {
  test(`expired amendment with ${status.toLowerCase()} payment activity remains blocking`, async () => {
    let paymentQuery: unknown;
    const row = {
      id: 'amendment-1',
      direction: 'ADDITIONAL_CHARGE',
      expiresAt: new Date('2026-09-03T02:59:00.000Z'),
    };
    const reader = fakeReader({
      findAmendment: async () => row,
      findPayment: async (args) => {
        paymentQuery = args;
        return { status };
      },
    });

    const result = await findActiveHospitalityBookingCommercialAmendment({
      reader,
      organizationId: 'organization-1',
      bookingId: 'booking-1',
      now: new Date('2026-09-03T03:00:00.000Z'),
    });

    assert.equal(result, row);
    assert.deepEqual(paymentQuery, {
      where: {
        organizationId: 'organization-1',
        bookingId: 'booking-1',
        commercialAmendmentId: 'amendment-1',
        status: { not: 'FAILED' },
      },
      select: { status: true },
    });
  });
}

test('active commercial amendment lookup preserves an empty result', async () => {
  const reader = fakeReader({ findAmendment: async () => null });

  const result = await findActiveHospitalityBookingCommercialAmendment({
    reader,
    organizationId: 'organization-1',
    bookingId: 'booking-1',
    now: new Date('2026-09-03T03:00:00.000Z'),
  });

  assert.equal(result, null);
});

test('payment activity recovery predicate fails closed for unresolved or successful evidence', () => {
  assert.equal(hospitalityCommercialAmendmentPaymentActivityRequiresRecovery([]), false);
  assert.equal(hospitalityCommercialAmendmentPaymentActivityRequiresRecovery([{ status: 'FAILED' }]), false);
  assert.equal(hospitalityCommercialAmendmentPaymentActivityRequiresRecovery([{ status: 'PENDING' }]), true);
  assert.equal(hospitalityCommercialAmendmentPaymentActivityRequiresRecovery([{ status: 'AMBIGUOUS' }]), true);
  assert.equal(hospitalityCommercialAmendmentPaymentActivityRequiresRecovery([{ status: 'SUCCEEDED' }]), true);
  assert.equal(
    hospitalityCommercialAmendmentPaymentActivityRequiresRecovery([
      { status: 'FAILED' },
      { status: 'SUCCEEDED' },
    ]),
    true,
  );
});

test('commercial amendment conflict messages are safe for booking and payment boundaries', () => {
  assert.match(ACTIVE_COMMERCIAL_AMENDMENT_CONFLICT_MESSAGE, /payment recovery/i);
  assert.match(COMMERCIAL_AMENDMENT_PAYMENT_RECOVERY_CONFLICT_MESSAGE, /reconciled or compensated/i);
  assert.doesNotMatch(
    `${ACTIVE_COMMERCIAL_AMENDMENT_CONFLICT_MESSAGE} ${COMMERCIAL_AMENDMENT_PAYMENT_RECOVERY_CONFLICT_MESSAGE}`,
    /provider|reference|idempotency|tenant/i,
  );
});
