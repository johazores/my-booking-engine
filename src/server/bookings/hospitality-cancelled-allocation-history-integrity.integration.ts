import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) {
  throw new Error('Hospitality cancelled-allocation integrity tests must run through npm run test:database with TEST_DATABASE_URL.');
}

test('cancellation requires coherent allocation evidence and freezes terminal allocation history', async () => {
  const [{ db }, holds, bookings, cancellation, pricing] = await Promise.all([
    import('../database.ts'),
    import('../availability/hospitality-availability-hold-service.ts'),
    import('./hospitality-booking-service.ts'),
    import('./hospitality-booking-cancellation-service.ts'),
    import('../pricing/hospitality-pricing-service.ts'),
  ]);

  const runId = crypto.randomUUID();
  const adminId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  try {
    const databaseClock = await db.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    const currentTime = databaseClock[0]?.now;
    assert.ok(currentTime instanceof Date, 'PostgreSQL clock is required for future booking fixtures');
    const dateAt = (days: number) => new Date(currentTime.getTime() + days * 86_400_000);
    const dateOnly = (days: number) => dateAt(days).toISOString().slice(0, 10);
    const admin = await db.user.create({ data: { id: adminId, email: `cancelled-allocation-admin-${runId}@example.test`, status: 'ACTIVE' } });
    const organization = await db.organization.create({
      data: { id: organizationId, name: 'Cancelled Allocation Tenant', slug: `cancelled-allocation-${runId}`.slice(0, 63), kind: 'HOTEL', currency: 'USD' },
    });
    await db.organizationMembership.create({
      data: { organizationId: organization.id, userId: admin.id, status: 'ACTIVE', role: 'ADMIN' },
    });
    const customer = await db.customer.create({
      data: { organizationId: organization.id, firstName: 'History', lastName: 'Guest', email: `cancelled-allocation-${runId}@example.test` },
    });
    const property = await db.hospitalityProperty.create({
      data: { organizationId: organization.id, name: 'History Hotel', code: 'HISTORY', timezone: 'UTC', countryCode: 'US' },
    });
    const roomType = await db.hospitalityRoomType.create({
      data: { organizationId: organization.id, propertyId: property.id, name: 'History Room', code: 'HISTORY', maxOccupancy: 2 },
    });
    await db.hospitalityRoom.create({
      data: { organizationId: organization.id, propertyId: property.id, roomTypeId: roomType.id, code: 'H101' },
    });
    const ratePlan = await db.hospitalityRatePlan.create({
      data: { organizationId: organization.id, propertyId: property.id, name: 'History Rate', code: 'HISTORY' },
    });
    await db.hospitalityRoomTypeRatePlan.create({
      data: { organizationId: organization.id, propertyId: property.id, roomTypeId: roomType.id, ratePlanId: ratePlan.id },
    });
    await pricing.createHospitalityBaseRate({
      organizationId: organization.id,
      actorUserId: admin.id,
      baseRate: {
        propertyId: property.id,
        roomTypeId: roomType.id,
        ratePlanId: ratePlan.id,
        startDate: dateOnly(0),
        endDate: dateOnly(29),
        amount: '100.00',
      },
    });

    const confirmationNow = dateAt(0);
    const request = {
      propertyId: property.id,
      roomTypeId: roomType.id,
      ratePlanId: ratePlan.id,
      arrivalDate: dateOnly(9),
      departureDate: dateOnly(11),
      quantity: 1,
    };
    const hold = await holds.createHospitalityAvailabilityHold({
      organizationId: organization.id,
      actorUserId: admin.id,
      now: confirmationNow,
      hold: { idempotencyKey: 'hold:cancelled-allocation-integrity', request },
    });
    const quote = await pricing.quoteHospitalityPrice({ organizationId: organization.id, actorUserId: admin.id, request });
    const booking = await bookings.confirmHospitalityBookingFromHold({
      organizationId: organization.id,
      actorUserId: admin.id,
      now: confirmationNow,
      confirmation: {
        holdId: hold.id,
        customerId: customer.id,
        idempotencyKey: 'booking:cancelled-allocation-integrity',
        expectedPricingFingerprint: quote.fingerprint,
        guests: [{ firstName: 'History', lastName: 'Guest' }],
      },
    });

    const allocation = await db.hospitalityBookingAllocation.findFirstOrThrow({
      where: { organizationId: organization.id, bookingId: booking.id },
      select: { id: true, quantity: true },
    });
    assert.equal(allocation.quantity, 1);

    await assert.rejects(
      db.hospitalityBookingAllocation.delete({ where: { id: allocation.id } }),
      /hospitality booking must retain allocation evidence/i,
    );

    await db.hospitalityBookingAllocation.update({
      where: { id: allocation.id },
      data: { quantity: 2 },
    });

    await assert.rejects(
      cancellation.cancelHospitalityBooking({
        organizationId: organization.id,
        actorUserId: admin.id,
        bookingId: booking.id,
        now: dateAt(1),
      }),
      /requires retained allocation evidence that matches the current commercial inventory state/i,
    );

    await db.hospitalityBookingAllocation.update({
      where: { id: allocation.id },
      data: { quantity: 1 },
    });

    const cancelled = await cancellation.cancelHospitalityBooking({
      organizationId: organization.id,
      actorUserId: admin.id,
      bookingId: booking.id,
      now: dateAt(1),
    });
    assert.equal(cancelled.status, 'CANCELLED');

    await assert.rejects(
      db.hospitalityBookingAllocation.update({
        where: { id: allocation.id },
        data: { quantity: 2 },
      }),
      /cancelled hospitality booking allocation history is immutable/i,
    );

    await assert.rejects(
      db.hospitalityBookingAllocation.update({
        where: { id: allocation.id },
        data: { departureDate: dateAt(12) },
      }),
      /cancelled hospitality booking allocation history is immutable/i,
    );

    await assert.rejects(
      db.hospitalityBookingAllocation.delete({ where: { id: allocation.id } }),
      /hospitality booking must retain allocation evidence/i,
    );

    const replay = await cancellation.cancelHospitalityBooking({
      organizationId: organization.id,
      actorUserId: admin.id,
      bookingId: booking.id,
      now: dateAt(2),
    });
    assert.equal(replay.status, 'CANCELLED');
  } finally {
    try {
      await db.auditEvent.deleteMany({ where: { organizationId } });
      await db.$transaction(async (transaction) => {
        await transaction.hospitalityBookingPricingEvidence.deleteMany({ where: { organizationId } });
        await transaction.hospitalityBookingGuest.deleteMany({ where: { organizationId } });
        await transaction.hospitalityBookingAllocation.deleteMany({ where: { organizationId } });
        await transaction.hospitalityBooking.deleteMany({ where: { organizationId } });
      });
      await db.hospitalityAvailabilityHold.deleteMany({ where: { organizationId } });
      await db.hospitalityBaseRate.deleteMany({ where: { organizationId } });
      await db.hospitalityRoomTypeRatePlan.deleteMany({ where: { organizationId } });
      await db.hospitalityRatePlan.deleteMany({ where: { organizationId } });
      await db.hospitalityRoom.deleteMany({ where: { organizationId } });
      await db.hospitalityRoomType.deleteMany({ where: { organizationId } });
      await db.hospitalityProperty.deleteMany({ where: { organizationId } });
      await db.customer.deleteMany({ where: { organizationId } });
      await db.organizationMembership.deleteMany({ where: { organizationId } });
      await db.organization.deleteMany({ where: { id: organizationId } });
      await db.user.deleteMany({ where: { id: adminId } });
    } finally {
      await db.$disconnect();
    }
  }
});