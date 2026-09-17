import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) {
  throw new Error('Rental payment integration tests must run through npm run test:database with TEST_DATABASE_URL.');
}

test('rental manual settlement is tenant-scoped, idempotent, append-only, supports partial refunds, and blocks cancellation until fully refunded', async () => {
  const [{ db }, holds, bookings, authority, cancellations, payments, pricing] = await Promise.all([
    import('../database.ts'),
    import('../inventory/rental-hold-service.ts'),
    import('../bookings/rental-booking-service.ts'),
    import('../bookings/rental-booking-authority-service.ts'),
    import('../bookings/rental-booking-cancellation-service.ts'),
    import('./rental-payment-service.ts'),
    import('../pricing/money.ts'),
  ]);

  const runId = crypto.randomUUID();
  const admin = await db.user.create({ data: { email: `rental-payment-admin-${runId}@example.test`, status: 'ACTIVE' } });
  const otherAdmin = await db.user.create({ data: { email: `rental-payment-other-${runId}@example.test`, status: 'ACTIVE' } });
  const organization = await db.organization.create({
    data: { name: 'Rental Payment Tenant', slug: `rental-payment-${runId}`.slice(0, 63), kind: 'RENTAL_BUSINESS', timezone: 'Asia/Manila', currency: 'PHP' },
  });
  const otherOrganization = await db.organization.create({
    data: { name: 'Other Rental Payment Tenant', slug: `rental-payment-other-${runId}`.slice(0, 63), kind: 'RENTAL_BUSINESS', timezone: 'Asia/Manila', currency: 'PHP' },
  });
  await Promise.all([
    db.organizationMembership.create({ data: { organizationId: organization.id, userId: admin.id, status: 'ACTIVE', role: 'ADMIN' } }),
    db.organizationMembership.create({ data: { organizationId: otherOrganization.id, userId: otherAdmin.id, status: 'ACTIVE', role: 'ADMIN' } }),
  ]);
  const customer = await db.customer.create({
    data: { organizationId: organization.id, firstName: 'Rental', lastName: 'Payer', email: `rental-payer-${runId}@example.test`, status: 'ACTIVE' },
  });
  const location = await db.rentalLocation.create({
    data: { organizationId: organization.id, name: 'Rental Payment Depot', code: `PAY-${runId.slice(0, 8)}`.toUpperCase(), addressLine1: '1 Test Street', city: 'Makati', countryCode: 'PH', timeZone: 'Asia/Manila', status: 'ACTIVE' },
  });
  const unitType = await db.rentalUnitType.create({
    data: { organizationId: organization.id, name: 'Rental Payment Bike', code: `TYPE-${runId.slice(0, 8)}`.toUpperCase(), currency: 'PHP', defaultDailyRateMinor: 125000, status: 'ACTIVE' },
  });
  const unit = await db.rentalUnit.create({
    data: { organizationId: organization.id, unitTypeId: unitType.id, locationId: location.id, name: 'Rental Payment Bike 001', code: `UNIT-${runId.slice(0, 8)}`.toUpperCase(), status: 'ACTIVE' },
  });

  const hold = await holds.createRentalAvailabilityHold({
    organizationId: organization.id,
    actorUserId: admin.id,
    hold: { unitId: unit.id, startsOn: '2026-11-10', endsOn: '2026-11-12', idempotencyKey: `rental-payment-hold:${runId}` },
  });
  const review = await authority.reviewRentalBookingConversionAuthority({ organizationId: organization.id, actorUserId: admin.id, holdId: hold.id, customerId: customer.id });
  assert.equal(review.ready, true);
  const confirmed = await bookings.confirmRentalBookingFromHold({
    organizationId: organization.id,
    actorUserId: admin.id,
    confirmation: { holdId: hold.id, customerId: customer.id, idempotencyKey: `rental-payment-booking:${runId}`, authorityFingerprint: review.authorityFingerprint as string },
  });

  await assert.rejects(
    db.rentalPaymentTransaction.create({
      data: {
        organizationId: organization.id,
        bookingId: confirmed.booking.id,
        idempotencyKey: `rental:manual-payment:${'a'.repeat(48)}`,
        kind: 'OFFLINE_PAYMENT',
        status: 'SUCCEEDED',
        providerCode: 'manual',
        providerReference: `NO-FP-${runId.slice(0, 12)}`,
        currency: confirmed.booking.currency,
        amountMinor: confirmed.booking.totalMinor,
      },
    }),
    /request fingerprint/i,
  );
  await assert.rejects(
    db.rentalPaymentTransaction.create({
      data: {
        organizationId: organization.id,
        bookingId: confirmed.booking.id,
        idempotencyKey: `rental:direct:${runId}`,
        requestFingerprint: 'b'.repeat(64),
        kind: 'OFFLINE_PAYMENT',
        status: 'SUCCEEDED',
        providerCode: 'manual',
        providerReference: `BAD-KEY-${runId.slice(0, 12)}`,
        currency: confirmed.booking.currency,
        amountMinor: confirmed.booking.totalMinor,
      },
    }),
    /idempotency key/i,
  );

  const callerAuthoredCreatedAt = new Date('2099-01-01T00:00:00.000Z');
  await assert.rejects(
    db.$transaction(async (transaction) => {
      const clockProbe = await transaction.rentalPaymentTransaction.create({
        data: {
          organizationId: organization.id,
          bookingId: confirmed.booking.id,
          idempotencyKey: `rental:manual-payment:${'c'.repeat(48)}`,
          requestFingerprint: 'd'.repeat(64),
          kind: 'OFFLINE_PAYMENT',
          status: 'SUCCEEDED',
          providerCode: 'manual',
          providerReference: `CLOCK-PROBE-${runId.slice(0, 12)}`,
          currency: confirmed.booking.currency,
          amountMinor: confirmed.booking.totalMinor,
          createdAt: callerAuthoredCreatedAt,
        },
      });
      const [databaseClock] = await transaction.$queryRaw<Array<{ databaseNow: Date }>>`
        SELECT clock_timestamp() AS "databaseNow"
      `;
      assert.ok(databaseClock);
      assert.notEqual(clockProbe.createdAt.getTime(), callerAuthoredCreatedAt.getTime());
      assert.ok(Math.abs(databaseClock.databaseNow.getTime() - clockProbe.createdAt.getTime()) < 5_000);
      throw new Error('ROLLBACK_RENTAL_PAYMENT_CLOCK_PROBE');
    }),
    /ROLLBACK_RENTAL_PAYMENT_CLOCK_PROBE/,
  );

  const paymentReference = `PAYMENT-${runId.slice(0, 12)}`;
  const payment = await payments.recordRentalManualOfflinePayment({ organizationId: organization.id, actorUserId: admin.id, bookingId: confirmed.booking.id, reference: paymentReference });
  assert.equal(payment.idempotent, false);
  assert.equal(payment.transaction.amountMinor, confirmed.booking.totalMinor);
  assert.equal(payment.transaction.currency, confirmed.booking.currency);
  assert.match(payment.transaction.requestFingerprint ?? '', /^[a-f0-9]{64}$/);

  const replay = await payments.recordRentalManualOfflinePayment({ organizationId: organization.id, actorUserId: admin.id, bookingId: confirmed.booking.id, reference: paymentReference });
  assert.equal(replay.idempotent, true);
  assert.equal(replay.transaction.id, payment.transaction.id);
  assert.equal(replay.transaction.requestFingerprint, payment.transaction.requestFingerprint);

  const paidHistory = await payments.listRentalBookingPaymentTransactions({ organizationId: organization.id, actorUserId: admin.id, bookingId: confirmed.booking.id });
  assert.equal(paidHistory.settlement.reconciled, true);
  assert.equal(paidHistory.settlement.reconciled && paidHistory.settlement.paymentState, 'PAID');

  await assert.rejects(
    payments.recordRentalManualOfflinePayment({ organizationId: otherOrganization.id, actorUserId: otherAdmin.id, bookingId: confirmed.booking.id, reference: `OTHER-${runId.slice(0, 12)}` }),
    /not available/i,
  );
  await assert.rejects(
    cancellations.cancelRentalBooking({ organizationId: organization.id, actorUserId: admin.id, bookingId: confirmed.booking.id }),
    /refund all settled rental money/i,
  );
  await assert.rejects(
    db.rentalBooking.update({ where: { id: confirmed.booking.id }, data: { status: 'CANCELLED', cancelledAt: new Date() } }),
    /settled money|payment/i,
  );

  const partialRefundMinor = confirmed.booking.totalMinor / 3n;
  assert.ok(partialRefundMinor > 0n && partialRefundMinor < confirmed.booking.totalMinor);
  const partialRefundAmount = pricing.moneyMinorToMajorString(partialRefundMinor, confirmed.booking.currency);
  const partialRefundReference = `REFUND-PART-${runId.slice(0, 10)}`;
  const partialRefund = await payments.recordRentalManualOfflineRefund({
    organizationId: organization.id,
    actorUserId: admin.id,
    bookingId: confirmed.booking.id,
    reference: partialRefundReference,
    amount: partialRefundAmount,
  });
  assert.equal(partialRefund.idempotent, false);
  assert.equal(partialRefund.transaction.sourceProviderReference, paymentReference);
  assert.equal(partialRefund.transaction.amountMinor, partialRefundMinor);
  assert.match(partialRefund.transaction.requestFingerprint ?? '', /^[a-f0-9]{64}$/);

  const partialRefundReplay = await payments.recordRentalManualOfflineRefund({
    organizationId: organization.id,
    actorUserId: admin.id,
    bookingId: confirmed.booking.id,
    reference: partialRefundReference,
    amount: partialRefundAmount,
  });
  assert.equal(partialRefundReplay.idempotent, true);
  assert.equal(partialRefundReplay.transaction.id, partialRefund.transaction.id);

  await assert.rejects(
    payments.recordRentalManualOfflineRefund({
      organizationId: organization.id,
      actorUserId: admin.id,
      bookingId: confirmed.booking.id,
      reference: partialRefundReference,
      amount: pricing.moneyMinorToMajorString(partialRefundMinor + 1n, confirmed.booking.currency),
    }),
    /different durable settlement evidence/i,
  );

  const partiallyRefundedHistory = await payments.listRentalBookingPaymentTransactions({ organizationId: organization.id, actorUserId: admin.id, bookingId: confirmed.booking.id });
  assert.equal(partiallyRefundedHistory.settlement.reconciled, true);
  assert.equal(partiallyRefundedHistory.settlement.reconciled && partiallyRefundedHistory.settlement.paymentState, 'PARTIALLY_REFUNDED');
  assert.equal(partiallyRefundedHistory.settlement.reconciled && partiallyRefundedHistory.settlement.refundedMinor, partialRefundMinor);
  assert.equal(partiallyRefundedHistory.settlement.reconciled && partiallyRefundedHistory.settlement.netSettledMinor, confirmed.booking.totalMinor - partialRefundMinor);

  await assert.rejects(
    cancellations.cancelRentalBooking({ organizationId: organization.id, actorUserId: admin.id, bookingId: confirmed.booking.id }),
    /refund all settled rental money/i,
  );

  const finalRefundReference = `REFUND-FINAL-${runId.slice(0, 9)}`;
  const finalRefund = await payments.recordRentalManualOfflineRefund({ organizationId: organization.id, actorUserId: admin.id, bookingId: confirmed.booking.id, reference: finalRefundReference });
  assert.equal(finalRefund.idempotent, false);
  assert.equal(finalRefund.transaction.sourceProviderReference, paymentReference);
  assert.equal(finalRefund.transaction.amountMinor, confirmed.booking.totalMinor - partialRefundMinor);
  assert.match(finalRefund.transaction.requestFingerprint ?? '', /^[a-f0-9]{64}$/);

  const partialReplayAfterFullRefund = await payments.recordRentalManualOfflineRefund({
    organizationId: organization.id,
    actorUserId: admin.id,
    bookingId: confirmed.booking.id,
    reference: partialRefundReference,
    amount: partialRefundAmount,
  });
  assert.equal(partialReplayAfterFullRefund.idempotent, true);
  assert.equal(partialReplayAfterFullRefund.transaction.id, partialRefund.transaction.id);

  const refundedHistory = await payments.listRentalBookingPaymentTransactions({ organizationId: organization.id, actorUserId: admin.id, bookingId: confirmed.booking.id });
  assert.equal(refundedHistory.settlement.reconciled, true);
  assert.equal(refundedHistory.settlement.reconciled && refundedHistory.settlement.paymentState, 'REFUNDED');
  assert.equal(refundedHistory.settlement.reconciled && refundedHistory.settlement.netSettledMinor, 0n);

  await assert.rejects(
    db.rentalPaymentTransaction.update({ where: { id: payment.transaction.id }, data: { providerReference: `${paymentReference}-EDIT` } }),
    /append-only/i,
  );

  const cancelled = await cancellations.cancelRentalBooking({ organizationId: organization.id, actorUserId: admin.id, bookingId: confirmed.booking.id });
  assert.equal(cancelled.booking.status, 'CANCELLED');

  const partialRefundReplayAfterCancellation = await payments.recordRentalManualOfflineRefund({
    organizationId: organization.id,
    actorUserId: admin.id,
    bookingId: confirmed.booking.id,
    reference: partialRefundReference,
    amount: partialRefundAmount,
  });
  assert.equal(partialRefundReplayAfterCancellation.idempotent, true);
  assert.equal(partialRefundReplayAfterCancellation.transaction.id, partialRefund.transaction.id);
  assert.equal(partialRefundReplayAfterCancellation.transaction.requestFingerprint, partialRefund.transaction.requestFingerprint);

  await assert.rejects(
    payments.recordRentalManualOfflinePayment({ organizationId: organization.id, actorUserId: admin.id, bookingId: confirmed.booking.id, reference: `AFTER-${runId.slice(0, 12)}` }),
    /confirmed rental bookings/i,
  );
  await assert.rejects(
    db.rentalPaymentTransaction.create({
      data: {
        organizationId: organization.id,
        bookingId: confirmed.booking.id,
        idempotencyKey: `rental:manual-payment:${'e'.repeat(48)}`,
        requestFingerprint: 'f'.repeat(64),
        kind: 'OFFLINE_PAYMENT',
        status: 'SUCCEEDED',
        providerCode: 'manual',
        providerReference: `DIRECT-${runId.slice(0, 12)}`,
        currency: confirmed.booking.currency,
        amountMinor: confirmed.booking.totalMinor,
      },
    }),
    /confirmed tenant booking/i,
  );
});
