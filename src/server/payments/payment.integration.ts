import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) throw new Error('Payment integration tests must run through npm run test:database with TEST_DATABASE_URL.');

test('manual offline payments and refunds are tenant scoped, idempotent, and use authoritative booking money', async () => {
  const [{ db }, payments] = await Promise.all([
    import('../database.ts'),
    import('./payment-service.ts'),
  ]);
  const runId = crypto.randomUUID();
  const adminA = await db.user.create({ data: { email: `payment-admin-a-${runId}@example.test`, status: 'ACTIVE' } });
  const staffA = await db.user.create({ data: { email: `payment-staff-a-${runId}@example.test`, status: 'ACTIVE' } });
  const adminB = await db.user.create({ data: { email: `payment-admin-b-${runId}@example.test`, status: 'ACTIVE' } });
  const organizationA = await db.organization.create({ data: { name: 'Payment Tenant A', slug: `payment-a-${runId}`.slice(0, 63), kind: 'HOTEL', currency: 'USD' } });
  const organizationB = await db.organization.create({ data: { name: 'Payment Tenant B', slug: `payment-b-${runId}`.slice(0, 63), kind: 'HOTEL', currency: 'USD' } });
  await db.organizationMembership.createMany({ data: [
    { organizationId: organizationA.id, userId: adminA.id, status: 'ACTIVE', role: 'ADMIN' },
    { organizationId: organizationA.id, userId: staffA.id, status: 'ACTIVE', role: 'STAFF' },
    { organizationId: organizationB.id, userId: adminB.id, status: 'ACTIVE', role: 'ADMIN' },
  ] });

  let bookingId: string | null = null;
  try {
    const customer = await db.customer.create({ data: { organizationId: organizationA.id, firstName: 'Paying', lastName: 'Guest' } });
    const property = await db.hospitalityProperty.create({ data: { organizationId: organizationA.id, name: 'Payment Hotel', code: 'PAY', timezone: 'UTC', countryCode: 'US' } });
    const roomType = await db.hospitalityRoomType.create({ data: { organizationId: organizationA.id, propertyId: property.id, name: 'Room', code: 'ROOM', maxOccupancy: 2 } });
    const ratePlan = await db.hospitalityRatePlan.create({ data: { organizationId: organizationA.id, propertyId: property.id, name: 'Flexible', code: 'FLEX' } });
    const hold = await db.hospitalityAvailabilityHold.create({ data: {
      organizationId: organizationA.id,
      propertyId: property.id,
      roomTypeId: roomType.id,
      ratePlanId: ratePlan.id,
      idempotencyKey: 'payment-test-hold',
      arrivalDate: new Date('2026-09-10T00:00:00.000Z'),
      departureDate: new Date('2026-09-11T00:00:00.000Z'),
      quantity: 1,
      status: 'CONSUMED',
      expiresAt: new Date('2026-09-10T01:00:00.000Z'),
      endedAt: new Date('2026-09-10T00:01:00.000Z'),
    } });
    const booking = await db.hospitalityBooking.create({ data: {
      organizationId: organizationA.id,
      propertyId: property.id,
      roomTypeId: roomType.id,
      ratePlanId: ratePlan.id,
      customerId: customer.id,
      holdId: hold.id,
      idempotencyKey: 'payment-test-booking',
      status: 'CONFIRMED',
      paymentStatus: 'UNPAID',
      arrivalDate: new Date('2026-09-10T00:00:00.000Z'),
      departureDate: new Date('2026-09-11T00:00:00.000Z'),
      quantity: 1,
      currency: 'USD',
      accommodationSubtotalMinor: 12345n,
      taxTotalMinor: 0n,
      feeTotalMinor: 0n,
      addonTotalMinor: 0n,
      totalMinor: 12345n,
      pricingFingerprint: 'a'.repeat(64),
      addonSelections: [],
      confirmedAt: new Date('2026-09-10T00:01:00.000Z'),
    } });
    bookingId = booking.id;

    await assert.rejects(
      payments.recordManualOfflinePayment({ organizationId: organizationA.id, actorUserId: staffA.id, bookingId: booking.id, idempotencyKey: 'payment:offline:1', reference: 'BANK-001' }),
      /permission/i,
    );
    await assert.rejects(
      payments.recordManualOfflinePayment({ organizationId: organizationB.id, actorUserId: adminB.id, bookingId: booking.id, idempotencyKey: 'payment:offline:1', reference: 'BANK-001' }),
      /not available/i,
    );

    const recorded = await payments.recordManualOfflinePayment({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      bookingId: booking.id,
      idempotencyKey: 'payment:offline:1',
      reference: ' BANK-001 ',
    });
    assert.equal(recorded.amountMinor, 12345n);
    assert.equal(recorded.currency, 'USD');
    assert.equal(recorded.providerCode, 'manual');
    assert.equal(recorded.providerReference, 'BANK-001');
    assert.equal(recorded.status, 'SUCCEEDED');

    const paidBooking = await db.hospitalityBooking.findUniqueOrThrow({ where: { id: booking.id } });
    assert.equal(paidBooking.paymentStatus, 'PAID');

    const retry = await payments.recordManualOfflinePayment({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      bookingId: booking.id,
      idempotencyKey: 'payment:offline:1',
      reference: 'BANK-001',
    });
    assert.equal(retry.id, recorded.id);
    assert.equal(await db.paymentTransaction.count({ where: { organizationId: organizationA.id, bookingId: booking.id } }), 1);

    await assert.rejects(
      payments.recordManualOfflinePayment({ organizationId: organizationA.id, actorUserId: adminA.id, bookingId: booking.id, idempotencyKey: 'payment:offline:1', reference: 'BANK-CHANGED' }),
      /different operation/i,
    );
    await assert.rejects(
      payments.recordManualOfflinePayment({ organizationId: organizationA.id, actorUserId: adminA.id, bookingId: booking.id, idempotencyKey: 'payment:offline:2', reference: 'BANK-002' }),
      /does not accept/i,
    );

    await assert.rejects(
      payments.recordManualOfflineRefund({ organizationId: organizationA.id, actorUserId: staffA.id, bookingId: booking.id, idempotencyKey: 'payment:refund:permission', reference: 'BANK-REFUND-PERMISSION', amountMinor: '100' }),
      /permission/i,
    );
    await assert.rejects(
      payments.recordManualOfflineRefund({ organizationId: organizationB.id, actorUserId: adminB.id, bookingId: booking.id, idempotencyKey: 'payment:refund:cross-tenant', reference: 'BANK-REFUND-CROSS-TENANT', amountMinor: '100' }),
      /not available/i,
    );
    await assert.rejects(
      payments.recordManualOfflineRefund({ organizationId: organizationA.id, actorUserId: adminA.id, bookingId: booking.id, idempotencyKey: 'payment:refund:too-large', reference: 'BANK-REFUND-TOO-LARGE', amountMinor: '12346' }),
      /exceeds the remaining refundable balance/i,
    );

    const partialRefund = await payments.recordManualOfflineRefund({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      bookingId: booking.id,
      idempotencyKey: 'payment:refund:1',
      reference: ' BANK-REFUND-001 ',
      amountMinor: '4000',
    });
    assert.equal(partialRefund.kind, 'REFUND');
    assert.equal(partialRefund.status, 'SUCCEEDED');
    assert.equal(partialRefund.amountMinor, 4000n);
    assert.equal(partialRefund.currency, 'USD');
    assert.equal(partialRefund.providerCode, 'manual');
    assert.equal(partialRefund.providerReference, 'BANK-REFUND-001');
    assert.equal((await db.hospitalityBooking.findUniqueOrThrow({ where: { id: booking.id } })).paymentStatus, 'PARTIALLY_REFUNDED');

    const partialRetry = await payments.recordManualOfflineRefund({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      bookingId: booking.id,
      idempotencyKey: 'payment:refund:1',
      reference: 'BANK-REFUND-001',
      amountMinor: '4000',
    });
    assert.equal(partialRetry.id, partialRefund.id);
    await assert.rejects(
      payments.recordManualOfflineRefund({ organizationId: organizationA.id, actorUserId: adminA.id, bookingId: booking.id, idempotencyKey: 'payment:refund:1', reference: 'BANK-REFUND-001', amountMinor: '4001' }),
      /different operation/i,
    );
    await assert.rejects(
      payments.recordManualOfflineRefund({ organizationId: organizationA.id, actorUserId: adminA.id, bookingId: booking.id, idempotencyKey: 'payment:refund:duplicate-reference', reference: 'BANK-REFUND-001', amountMinor: '100' }),
      /reference has already been recorded/i,
    );

    const finalRefund = await payments.recordManualOfflineRefund({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      bookingId: booking.id,
      idempotencyKey: 'payment:refund:2',
      reference: 'BANK-REFUND-002',
    });
    assert.equal(finalRefund.amountMinor, 8345n);
    assert.equal((await db.hospitalityBooking.findUniqueOrThrow({ where: { id: booking.id } })).paymentStatus, 'REFUNDED');
    await assert.rejects(
      payments.recordManualOfflineRefund({ organizationId: organizationA.id, actorUserId: adminA.id, bookingId: booking.id, idempotencyKey: 'payment:refund:after-full', reference: 'BANK-REFUND-003' }),
      /does not accept a refund/i,
    );

    const history = await payments.listBookingPaymentTransactions({ organizationId: organizationA.id, actorUserId: staffA.id, bookingId: booking.id });
    assert.equal(history.total, 3);
    assert.deepEqual(new Set(history.transactions.map((transaction) => transaction.id)), new Set([recorded.id, partialRefund.id, finalRefund.id]));
    await assert.rejects(
      payments.listBookingPaymentTransactions({ organizationId: organizationB.id, actorUserId: adminB.id, bookingId: booking.id }),
      /not available/i,
    );

    const paymentEvents = await db.auditEvent.findMany({ where: { organizationId: organizationA.id, action: 'payment.offline-recorded', resourceId: recorded.id } });
    assert.equal(paymentEvents.length, 1);
    assert.equal(JSON.stringify(paymentEvents[0]?.afterData).includes('BANK-001'), false);
    const refundEvents = await db.auditEvent.findMany({ where: { organizationId: organizationA.id, action: 'payment.offline-refund-recorded', resourceId: { in: [partialRefund.id, finalRefund.id] } } });
    assert.equal(refundEvents.length, 2);
    const refundAuditPayload = JSON.stringify(refundEvents.map((event) => event.afterData));
    assert.equal(refundAuditPayload.includes('BANK-001'), false);
    assert.equal(refundAuditPayload.includes('BANK-REFUND-001'), false);
    assert.equal(refundAuditPayload.includes('BANK-REFUND-002'), false);

    await assert.rejects(
      db.paymentTransaction.create({ data: {
        organizationId: organizationB.id,
        bookingId: booking.id,
        idempotencyKey: 'payment:cross-tenant-fk',
        kind: 'OFFLINE_PAYMENT',
        status: 'SUCCEEDED',
        providerCode: 'manual',
        providerReference: 'CROSS-TENANT',
        currency: 'USD',
        amountMinor: 12345n,
      } }),
    );
  } finally {
    await db.auditEvent.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.paymentTransaction.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    if (bookingId) await db.hospitalityBooking.deleteMany({ where: { id: bookingId } });
    await db.hospitalityAvailabilityHold.deleteMany({ where: { organizationId: organizationA.id } });
    await db.hospitalityRatePlan.deleteMany({ where: { organizationId: organizationA.id } });
    await db.hospitalityRoomType.deleteMany({ where: { organizationId: organizationA.id } });
    await db.hospitalityProperty.deleteMany({ where: { organizationId: organizationA.id } });
    await db.customer.deleteMany({ where: { organizationId: organizationA.id } });
    await db.organizationMembership.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.organization.deleteMany({ where: { id: { in: [organizationA.id, organizationB.id] } } });
    await db.user.deleteMany({ where: { id: { in: [adminA.id, staffA.id, adminB.id] } } });
  }
});
