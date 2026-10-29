import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) throw new Error('Hospitality booking reschedule integration tests must run through npm run test:database with TEST_DATABASE_URL.');

test('booking reschedule is tenant-safe, capacity-safe, price-safe, and idempotent', async () => {
  const [{ db }, holds, bookings, reschedules, pricing] = await Promise.all([
    import('../database.ts'),
    import('../availability/hospitality-availability-hold-service.ts'),
    import('./hospitality-booking-service.ts'),
    import('./hospitality-booking-reschedule-service.ts'),
    import('../pricing/hospitality-pricing-service.ts'),
  ]);
  const runId = crypto.randomUUID();
  const userIds = Array.from({ length: 3 }, () => crypto.randomUUID());
  const organizationIds = Array.from({ length: 2 }, () => crypto.randomUUID());
  try {
    const databaseClock = await db.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    const currentTime = databaseClock[0]?.now;
    assert.ok(currentTime instanceof Date, 'PostgreSQL clock is required for future booking fixtures');
    const dateAt = (days: number) => new Date(currentTime.getTime() + days * 86_400_000);
    const dateOnly = (days: number) => dateAt(days).toISOString().slice(0, 10);
    const adminA = await db.user.create({ data: { id: userIds[0], email: `reschedule-admin-a-${runId}@example.test`, status: 'ACTIVE' } });
    const staffA = await db.user.create({ data: { id: userIds[1], email: `reschedule-staff-a-${runId}@example.test`, status: 'ACTIVE' } });
    const adminB = await db.user.create({ data: { id: userIds[2], email: `reschedule-admin-b-${runId}@example.test`, status: 'ACTIVE' } });
    const organizationA = await db.organization.create({ data: { id: organizationIds[0], name: 'Reschedule Tenant A', slug: `reschedule-a-${runId}`.slice(0, 63), kind: 'HOTEL', currency: 'USD' } });
    const organizationB = await db.organization.create({ data: { id: organizationIds[1], name: 'Reschedule Tenant B', slug: `reschedule-b-${runId}`.slice(0, 63), kind: 'HOTEL', currency: 'USD' } });
    await db.organizationMembership.createMany({ data: [
      { organizationId: organizationA.id, userId: adminA.id, status: 'ACTIVE', role: 'ADMIN' },
      { organizationId: organizationA.id, userId: staffA.id, status: 'ACTIVE', role: 'STAFF' },
      { organizationId: organizationB.id, userId: adminB.id, status: 'ACTIVE', role: 'ADMIN' },
    ] });
    const customer = await db.customer.create({ data: { organizationId: organizationA.id, firstName: 'Reschedule', lastName: 'Guest', email: `reschedule-guest-${runId}@example.test` } });
    const property = await db.hospitalityProperty.create({ data: { organizationId: organizationA.id, name: 'Reschedule Hotel', code: 'RSC', timezone: 'UTC', countryCode: 'US' } });
    const roomType = await db.hospitalityRoomType.create({ data: { organizationId: organizationA.id, propertyId: property.id, name: 'Standard', code: 'STD', maxOccupancy: 2 } });
    await db.hospitalityRoom.create({ data: { organizationId: organizationA.id, propertyId: property.id, roomTypeId: roomType.id, code: '101' } });
    const ratePlan = await db.hospitalityRatePlan.create({ data: { organizationId: organizationA.id, propertyId: property.id, name: 'Flexible', code: 'FLEX' } });
    await db.hospitalityRoomTypeRatePlan.create({ data: { organizationId: organizationA.id, propertyId: property.id, roomTypeId: roomType.id, ratePlanId: ratePlan.id } });
    const baseRate = await pricing.createHospitalityBaseRate({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      baseRate: { propertyId: property.id, roomTypeId: roomType.id, ratePlanId: ratePlan.id, startDate: dateOnly(0), endDate: dateOnly(60), amount: '100.00' },
    });

    const now = dateAt(0);
    const originalRequest = { propertyId: property.id, roomTypeId: roomType.id, ratePlanId: ratePlan.id, arrivalDate: dateOnly(9), departureDate: dateOnly(11), quantity: 1 };
    const hold = await holds.createHospitalityAvailabilityHold({ organizationId: organizationA.id, actorUserId: adminA.id, now, hold: { idempotencyKey: 'hold:reschedule-main', request: originalRequest } });
    const quote = await pricing.quoteHospitalityPrice({ organizationId: organizationA.id, actorUserId: adminA.id, request: originalRequest });
    const booking = await bookings.confirmHospitalityBookingFromHold({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      now,
      confirmation: { holdId: hold.id, customerId: customer.id, idempotencyKey: 'booking:reschedule-main', expectedPricingFingerprint: quote.fingerprint, guests: [{ firstName: 'Reschedule', lastName: 'Guest' }] },
    });

    const firstChange = { arrivalDate: dateOnly(10), departureDate: dateOnly(12), idempotencyKey: 'reschedule:first-change' };
    const firstChangeQuote = await pricing.quoteHospitalityPrice({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      request: { ...originalRequest, arrivalDate: firstChange.arrivalDate, departureDate: firstChange.departureDate },
    });
    assert.notEqual(firstChangeQuote.fingerprint, booking.pricingFingerprint);
    await assert.rejects(reschedules.rescheduleHospitalityBooking({ organizationId: organizationA.id, actorUserId: staffA.id, bookingId: booking.id, change: firstChange, now }), /permission/i);
    await assert.rejects(reschedules.rescheduleHospitalityBooking({ organizationId: organizationB.id, actorUserId: adminB.id, bookingId: booking.id, change: firstChange, now }), /not available/i);

    const pendingPayment = await db.paymentTransaction.create({
      data: {
        organizationId: organizationA.id,
        bookingId: booking.id,
        idempotencyKey: 'reschedule:pending-payment',
        kind: 'CAPTURE',
        status: 'PENDING',
        providerCode: 'TEST',
        providerReference: `pending-${runId}`,
        currency: booking.currency,
        amountMinor: booking.totalMinor,
      },
    });
    await assert.rejects(
      reschedules.rescheduleHospitalityBooking({ organizationId: organizationA.id, actorUserId: adminA.id, bookingId: booking.id, change: firstChange, now }),
      /unresolved payment operation/i,
    );
    await db.paymentTransaction.delete({ where: { id: pendingPayment.id } });

    const rescheduled = await reschedules.rescheduleHospitalityBooking({ organizationId: organizationA.id, actorUserId: adminA.id, bookingId: booking.id, change: firstChange, now });
    assert.equal(rescheduled.arrivalDate.toISOString().slice(0, 10), dateOnly(10));
    assert.equal(rescheduled.departureDate.toISOString().slice(0, 10), dateOnly(12));
    assert.equal(rescheduled.totalMinor.toString(), booking.totalMinor.toString());
    assert.equal(rescheduled.pricingFingerprint, firstChangeQuote.fingerprint);
    assert.equal(rescheduled.paymentStatus, booking.paymentStatus);
    const allocation = await db.hospitalityBookingAllocation.findUniqueOrThrow({ where: { organizationId_bookingId: { organizationId: organizationA.id, bookingId: booking.id } } });
    assert.equal(allocation.arrivalDate.toISOString().slice(0, 10), dateOnly(10));
    assert.equal(allocation.departureDate.toISOString().slice(0, 10), dateOnly(12));

    const exactRetry = await reschedules.rescheduleHospitalityBooking({ organizationId: organizationA.id, actorUserId: adminA.id, bookingId: booking.id, change: firstChange, now });
    assert.equal(exactRetry.id, booking.id);
    assert.equal(exactRetry.pricingFingerprint, firstChangeQuote.fingerprint);
    assert.equal(await db.auditEvent.count({ where: { organizationId: organizationA.id, resourceType: 'hospitality-booking', resourceId: booking.id, action: 'booking.rescheduled' } }), 1);
    await assert.rejects(
      reschedules.rescheduleHospitalityBooking({ organizationId: organizationA.id, actorUserId: adminA.id, bookingId: booking.id, change: { ...firstChange, departureDate: dateOnly(13) }, now }),
      /idempotency key/i,
    );

    await db.hospitalityBaseRate.update({ where: { id: baseRate.id }, data: { amountMinor: 11_000n } });
    await assert.rejects(
      reschedules.rescheduleHospitalityBooking({ organizationId: organizationA.id, actorUserId: adminA.id, bookingId: booking.id, change: { arrivalDate: dateOnly(13), departureDate: dateOnly(15), idempotencyKey: 'reschedule:price-change' }, now }),
      /payment-adjustment workflow/i,
    );
    const afterRejectedPrice = await db.hospitalityBooking.findUniqueOrThrow({ where: { id: booking.id } });
    assert.equal(afterRejectedPrice.arrivalDate.toISOString().slice(0, 10), dateOnly(10));
    assert.equal(afterRejectedPrice.pricingFingerprint, firstChangeQuote.fingerprint);
    await db.hospitalityBaseRate.update({ where: { id: baseRate.id }, data: { amountMinor: 10_000n } });

    const blockingHoldRequest = { propertyId: property.id, roomTypeId: roomType.id, ratePlanId: ratePlan.id, arrivalDate: dateOnly(19), departureDate: dateOnly(21), quantity: 1 };
    await holds.createHospitalityAvailabilityHold({ organizationId: organizationA.id, actorUserId: adminA.id, now, hold: { idempotencyKey: 'hold:reschedule-block', request: blockingHoldRequest } });
    await assert.rejects(
      reschedules.rescheduleHospitalityBooking({ organizationId: organizationA.id, actorUserId: adminA.id, bookingId: booking.id, change: { arrivalDate: dateOnly(19), departureDate: dateOnly(21), idempotencyKey: 'reschedule:blocked-capacity' }, now }),
      /enough sellable inventory/i,
    );

    const secondChange = { arrivalDate: dateOnly(14), departureDate: dateOnly(16), idempotencyKey: 'reschedule:second-change' };
    const secondChangeQuote = await pricing.quoteHospitalityPrice({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      request: { ...originalRequest, arrivalDate: secondChange.arrivalDate, departureDate: secondChange.departureDate },
    });
    const secondReschedule = await reschedules.rescheduleHospitalityBooking({ organizationId: organizationA.id, actorUserId: adminA.id, bookingId: booking.id, change: secondChange, now });
    assert.equal(secondReschedule.pricingFingerprint, secondChangeQuote.fingerprint);
    await assert.rejects(
      reschedules.rescheduleHospitalityBooking({ organizationId: organizationA.id, actorUserId: adminA.id, bookingId: booking.id, change: firstChange, now }),
      /changed again afterward/i,
    );

    const events = await db.auditEvent.findMany({ where: { organizationId: organizationA.id, resourceType: 'hospitality-booking', resourceId: booking.id, action: 'booking.rescheduled' }, orderBy: { createdAt: 'asc' } });
    assert.equal(events.length, 2);
    assert.equal((events[0]?.beforeData as { arrivalDate?: string } | null)?.arrivalDate, dateOnly(9));
    assert.equal((events[0]?.beforeData as { pricingFingerprint?: string } | null)?.pricingFingerprint, quote.fingerprint);
    assert.equal((events[0]?.afterData as { arrivalDate?: string } | null)?.arrivalDate, dateOnly(10));
    assert.equal((events[0]?.afterData as { pricingFingerprint?: string } | null)?.pricingFingerprint, firstChangeQuote.fingerprint);
    assert.equal(JSON.stringify(events).includes('reschedule-guest-'), false);
  } finally {
    try {
      await db.auditEvent.deleteMany({ where: { organizationId: { in: [organizationIds[0], organizationIds[1]] } } });
      await db.paymentCheckoutSession.deleteMany({ where: { organizationIds[0] } });
      await db.paymentTransaction.deleteMany({ where: { organizationIds[0] } });
      await db.$transaction(async (transaction) => {
        await transaction.hospitalityBookingPricingEvidence.deleteMany({ where: { organizationIds[0] } });
        await transaction.hospitalityBookingGuest.deleteMany({ where: { organizationIds[0] } });
        await transaction.hospitalityBookingAllocation.deleteMany({ where: { organizationIds[0] } });
        await transaction.hospitalityBooking.deleteMany({ where: { organizationIds[0] } });
      });
      await db.hospitalityAvailabilityHold.deleteMany({ where: { organizationIds[0] } });
      await db.hospitalityBaseRate.deleteMany({ where: { organizationIds[0] } });
      await db.hospitalityRoomTypeRatePlan.deleteMany({ where: { organizationIds[0] } });
      await db.hospitalityRatePlan.deleteMany({ where: { organizationIds[0] } });
      await db.hospitalityRoom.deleteMany({ where: { organizationIds[0] } });
      await db.hospitalityRoomType.deleteMany({ where: { organizationIds[0] } });
      await db.hospitalityProperty.deleteMany({ where: { organizationIds[0] } });
      await db.customer.deleteMany({ where: { organizationIds[0] } });
      await db.organizationMembership.deleteMany({ where: { organizationId: { in: [organizationIds[0], organizationIds[1]] } } });
      await db.organization.deleteMany({ where: { id: { in: [organizationIds[0], organizationIds[1]] } } });
      await db.user.deleteMany({ where: { id: { in: [userIds[0], userIds[1], userIds[2]] } } });
    } finally {
      await db.$disconnect();
    }
  }
});