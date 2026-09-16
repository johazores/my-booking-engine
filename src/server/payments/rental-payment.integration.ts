import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) {
  throw new Error('Rental payment integration tests must run through npm run test:database with TEST_DATABASE_URL.');
}

test('rental manual settlement is tenant-scoped, idempotent, append-only, and blocks cancellation until fully refunded', async () => {
  const [{ db }, holds, bookings, authority, cancellations, payments] = await Promise.all([
    import('../database.ts'),
    import('../inventory/rental-hold-service.ts'),
    import('../bookings/rental-booking-service.ts'),
    import('../bookings/rental-booking-authority-service.ts'),
    import('../bookings/rental-booking-cancellation-service.ts'),
    import('./rental-payment-service.ts'),
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
  await assert.rejects(
    db.rentalPaymentTransaction.create({
      data: {
        organizationId: organization.id,
        bookingId: confirmed.booking.id,
        idempotencyKey: `rental:manual-payment:${'c'.repeat(48)}`,
        requestFingerprint: 'd'.repeat(64),
        kind: 'OFFLINE_PAYMENT',
        status: 'SUCCEEDED',
        providerCode: 'manual',
        providerReference: `BAD-TIME-${runId.slice(0, 12)}`,
        currency: confirmed.booking.currency,
        amountMinor: confirmed.booking.totalMinor,
        createdAt: new Date('2099-01-01T00:00:00.000Z'),
      },
    }),
    /creation time/i,
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

  const refundReference = `REFUND-${runId.slice(0, 12)}`;
  const refund = await payments.recordRentalManualOfflineRefund({ organizationId: organization.id, actorUserId: admin.id, bookingId: confirmed.booking.id, reference: refundReference });
  assert.equal(refund.idempotent, false);
  assert.equal(refund.transaction.sourceProviderReference, paymentReference);
  assert.equal(refund.transaction.amountMinor, confirmed.booking.totalMinor);
  assert.match(refund.transaction.requestFingerprint ?? '', /^[a-f0-9]{64}$/);

  const refundReplay = await payments.recordRentalManualOfflineRefund({ organizationId: organization.id, actorUserId: admin.id, bookingId: confirmed.booking.id, reference: refundReference });
  assert.equal(refundReplay.idempotent, true);
  assert.equal(refundReplay.transaction.id, refund.transaction.id);
  assert.equal(refundReplay.transaction.requestFingerprint, refund.transaction.requestFingerprint);

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

  const refundReplayAfterCancellation = await payments.recordRentalManualOfflineRefund({ organizationId: organization.id, actorUserId: admin.id, bookingId: confirmed.booking.id, reference: refundReference });
  assert.equal(refundReplayAfterCancellation.idempotent, true);
  assert.equal(refundReplayAfterCancellation.transaction.id, refund.transaction.id);
  assert.equal(refundReplayAfterCancellation.transaction.requestFingerprint, refund.transaction.requestFingerprint);

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
