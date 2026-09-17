import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) {
  throw new Error('Rental payment integration tests must run through npm run test:database with TEST_DATABASE_URL.');
}

test('rental manual settlement is tenant-scoped, idempotent, append-only, supports partial funding/refunds, and blocks cancellation until fully refunded', async () => {
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
      const [databaseClock] = await transaction.$queryRaw<Array<{ databaseNow: Date }>>`SELECT clock_timestamp() AS "databaseNow"`;
      assert.ok(databaseClock);
      assert.notEqual(clockProbe.createdAt.getTime(), callerAuthoredCreatedAt.getTime());
      assert.ok(Math.abs(databaseClock.databaseNow.getTime() - clockProbe.createdAt.getTime()) < 5_000);
      throw new Error('ROLLBACK_RENTAL_PAYMENT_CLOCK_PROBE');
    }),
    /ROLLBACK_RENTAL_PAYMENT_CLOCK_PROBE/,
  );

  const partialPaymentMinor = confirmed.booking.totalMinor / 3n;
  assert.ok(partialPaymentMinor > 0n && partialPaymentMinor < confirmed.booking.totalMinor);
  const partialPaymentAmount = pricing.moneyMinorToMajorString(partialPaymentMinor, confirmed.booking.currency);
  const firstPaymentReference = `PAYMENT-PART-${runId.slice(0, 10)}`;
  const firstPayment = await payments.recordRentalManualOfflinePayment({
    organizationId: organization.id,
    actorUserId: admin.id,
    bookingId: confirmed.booking.id,
    reference: firstPaymentReference,
    amount: partialPaymentAmount,
  });
  assert.equal(firstPayment.idempotent, false);
  assert.equal(firstPayment.transaction.amountMinor, partialPaymentMinor);
  assert.match(firstPayment.transaction.requestFingerprint ?? '', /^[a-f0-9]{64}$/);

  const partialPaymentReplay = await payments.recordRentalManualOfflinePayment({
    organizationId: organization.id,
    actorUserId: admin.id,
    bookingId: confirmed.booking.id,
    reference: firstPaymentReference,
    amount: partialPaymentAmount,
  });
  assert.equal(partialPaymentReplay.idempotent, true);
  assert.equal(partialPaymentReplay.transaction.id, firstPayment.transaction.id);

  await assert.rejects(
    payments.recordRentalManualOfflinePayment({
      organizationId: organization.id,
      actorUserId: admin.id,
      bookingId: confirmed.booking.id,
      reference: firstPaymentReference,
      amount: pricing.moneyMinorToMajorString(partialPaymentMinor + 1n, confirmed.booking.currency),
    }),
    /different durable settlement evidence/i,
  );

  const partiallyPaid = await payments.listRentalBookingPaymentTransactions({ organizationId: organization.id, actorUserId: admin.id, bookingId: confirmed.booking.id });
  assert.equal(partiallyPaid.settlement.reconciled, true);
  assert.equal(partiallyPaid.settlement.reconciled && partiallyPaid.settlement.paymentState, 'PARTIALLY_PAID');
  assert.equal(partiallyPaid.settlement.reconciled && partiallyPaid.settlement.netSettledMinor, partialPaymentMinor);
  assert.equal(partiallyPaid.settlement.reconciled && partiallyPaid.settlement.outstandingMinor, confirmed.booking.totalMinor - partialPaymentMinor);

  await assert.rejects(
    cancellations.cancelRentalBooking({ organizationId: organization.id, actorUserId: admin.id, bookingId: confirmed.booking.id }),
    /refund all settled rental money/i,
  );

  const secondPaymentMinor = confirmed.booking.totalMinor - partialPaymentMinor;
  const secondPaymentReference = `PAYMENT-FINAL-${runId.slice(0, 9)}`;
  const secondPayment = await payments.recordRentalManualOfflinePayment({
    organizationId: organization.id,
    actorUserId: admin.id,
    bookingId: confirmed.booking.id,
    reference: secondPaymentReference,
    amount: pricing.moneyMinorToMajorString(secondPaymentMinor, confirmed.booking.currency),
  });
  assert.equal(secondPayment.idempotent, false);
  assert.equal(secondPayment.transaction.amountMinor, secondPaymentMinor);

  const paidHistory = await payments.listRentalBookingPaymentTransactions({ organizationId: organization.id, actorUserId: admin.id, bookingId: confirmed.booking.id });
  assert.equal(paidHistory.settlement.reconciled, true);
  assert.equal(paidHistory.settlement.reconciled && paidHistory.settlement.paymentState, 'PAID');
  assert.equal(paidHistory.settlement.reconciled && paidHistory.settlement.outstandingMinor, 0n);

  await assert.rejects(
    payments.recordRentalManualOfflinePayment({
      organizationId: organization.id,
      actorUserId: admin.id,
      bookingId: confirmed.booking.id,
      reference: `OVER-${runId.slice(0, 12)}`,
      amount: pricing.moneyMinorToMajorString(1n, confirmed.booking.currency),
    }),
    /outstanding balance/i,
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
        providerReference: `DIRECT-OVER-${runId.slice(0, 8)}`,
        currency: confirmed.booking.currency,
        amountMinor: 1n,
      },
    }),
    /outstanding authoritative booking balance/i,
  );

  await assert.rejects(
    payments.recordRentalManualOfflinePayment({ organizationId: otherOrganization.id, actorUserId: otherAdmin.id, bookingId: confirmed.booking.id, reference: `OTHER-${runId.slice(0, 12)}`, amount: partialPaymentAmount }),
    /not available/i,
  );

  const partialRefundMinor = secondPaymentMinor / 2n;
  assert.ok(partialRefundMinor > 0n);
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
  assert.equal(partialRefund.transaction.sourceProviderReference, secondPaymentReference);
  assert.equal(partialRefund.transaction.amountMinor, partialRefundMinor);

  const partiallyRefundedHistory = await payments.listRentalBookingPaymentTransactions({ organizationId: organization.id, actorUserId: admin.id, bookingId: confirmed.booking.id });
  assert.equal(partiallyRefundedHistory.settlement.reconciled, true);
  assert.equal(partiallyRefundedHistory.settlement.reconciled && partiallyRefundedHistory.settlement.paymentState, 'PARTIALLY_REFUNDED');
  assert.equal(partiallyRefundedHistory.settlement.reconciled && partiallyRefundedHistory.settlement.outstandingMinor, partialRefundMinor);

  const replacementReference = `PAYMENT-REPL-${runId.slice(0, 10)}`;
  const replacementPayment = await payments.recordRentalManualOfflinePayment({
    organizationId: organization.id,
    actorUserId: admin.id,
    bookingId: confirmed.booking.id,
    reference: replacementReference,
    amount: partialRefundAmount,
  });
  assert.equal(replacementPayment.idempotent, false);
  assert.equal(replacementPayment.transaction.amountMinor, partialRefundMinor);

  const repaidHistory = await payments.listRentalBookingPaymentTransactions({ organizationId: organization.id, actorUserId: admin.id, bookingId: confirmed.booking.id });
  assert.equal(repaidHistory.settlement.reconciled, true);
  assert.equal(repaidHistory.settlement.reconciled && repaidHistory.settlement.paymentState, 'PAID');
  assert.equal(repaidHistory.settlement.reconciled && repaidHistory.settlement.netSettledMinor, confirmed.booking.totalMinor);
  assert.ok(repaidHistory.settlement.reconciled && repaidHistory.settlement.grossSettledMinor > confirmed.booking.totalMinor);

  let refundIndex = 0;
  for (;;) {
    const current = await payments.listRentalBookingPaymentTransactions({ organizationId: organization.id, actorUserId: admin.id, bookingId: confirmed.booking.id });
    assert.equal(current.settlement.reconciled, true);
    if (current.settlement.reconciled && current.settlement.netSettledMinor === 0n) break;
    refundIndex += 1;
    assert.ok(refundIndex <= 4, 'bounded source refunds should reach zero settlement');
    await payments.recordRentalManualOfflineRefund({
      organizationId: organization.id,
      actorUserId: admin.id,
      bookingId: confirmed.booking.id,
      reference: `REFUND-FINAL-${refundIndex}-${runId.slice(0, 6)}`,
    });
  }

  const refundedHistory = await payments.listRentalBookingPaymentTransactions({ organizationId: organization.id, actorUserId: admin.id, bookingId: confirmed.booking.id });
  assert.equal(refundedHistory.settlement.reconciled, true);
  assert.equal(refundedHistory.settlement.reconciled && refundedHistory.settlement.paymentState, 'REFUNDED');
  assert.equal(refundedHistory.settlement.reconciled && refundedHistory.settlement.netSettledMinor, 0n);

  const partialRefundReplay = await payments.recordRentalManualOfflineRefund({
    organizationId: organization.id,
    actorUserId: admin.id,
    bookingId: confirmed.booking.id,
    reference: partialRefundReference,
    amount: partialRefundAmount,
  });
  assert.equal(partialRefundReplay.idempotent, true);
  assert.equal(partialRefundReplay.transaction.id, partialRefund.transaction.id);

  const partialReplayAfterFullRefund = await payments.recordRentalManualOfflineRefund({
    organizationId: organization.id,
    actorUserId: admin.id,
    bookingId: confirmed.booking.id,
    reference: partialRefundReference,
    amount: partialRefundAmount,
  });
  assert.equal(partialReplayAfterFullRefund.idempotent, true);
  assert.equal(partialReplayAfterFullRefund.transaction.id, partialRefund.transaction.id);

  await assert.rejects(
    db.rentalPaymentTransaction.update({ where: { id: firstPayment.transaction.id }, data: { providerReference: `${firstPaymentReference}-EDIT` } }),
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

  const replayAfterCancellation = await payments.recordRentalManualOfflinePayment({
    organizationId: organization.id,
    actorUserId: admin.id,
    bookingId: confirmed.booking.id,
    reference: firstPaymentReference,
    amount: partialPaymentAmount,
  });
  assert.equal(replayAfterCancellation.idempotent, true);
  assert.equal(replayAfterCancellation.transaction.id, firstPayment.transaction.id);

  await assert.rejects(
    payments.recordRentalManualOfflinePayment({ organizationId: organization.id, actorUserId: admin.id, bookingId: confirmed.booking.id, reference: `AFTER-${runId.slice(0, 12)}`, amount: partialPaymentAmount }),
    /confirmed rental bookings/i,
  );
});
