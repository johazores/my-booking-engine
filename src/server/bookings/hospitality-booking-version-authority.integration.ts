import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) {
  throw new Error('Hospitality booking version/identity-authority integration tests must run through npm run test:database with TEST_DATABASE_URL.');
}

test('PostgreSQL authors monotonic hospitality booking versions and retains durable row identity', async () => {
  const [{ db }, holds, bookings, pricing] = await Promise.all([
    import('../database.ts'),
    import('../availability/hospitality-availability-hold-service.ts'),
    import('./hospitality-booking-service.ts'),
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
    const admin = await db.user.create({ data: { id: adminId, email: `booking-version-admin-${runId}@example.test`, status: 'ACTIVE' } });
    const organization = await db.organization.create({
      data: { id: organizationId, name: 'Booking Version Tenant', slug: `booking-version-${runId}`.slice(0, 63), kind: 'HOTEL', currency: 'USD' },
    });
    await db.organizationMembership.create({
      data: { organizationId: organization.id, userId: admin.id, status: 'ACTIVE', role: 'ADMIN' },
    });
    const customer = await db.customer.create({
      data: { organizationId: organization.id, firstName: 'Version', lastName: 'Guest', email: `booking-version-${runId}@example.test` },
    });
    const property = await db.hospitalityProperty.create({
      data: { organizationId: organization.id, name: 'Version Hotel', code: 'VERSION', timezone: 'UTC', countryCode: 'US' },
    });
    const roomType = await db.hospitalityRoomType.create({
      data: { organizationId: organization.id, propertyId: property.id, name: 'Version Room', code: 'VERSION', maxOccupancy: 2 },
    });
    await db.hospitalityRoom.create({
      data: { organizationId: organization.id, propertyId: property.id, roomTypeId: roomType.id, code: 'V101' },
    });
    const ratePlan = await db.hospitalityRatePlan.create({
      data: { organizationId: organization.id, propertyId: property.id, name: 'Version Rate', code: 'VERSION' },
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

    const now = dateAt(0);
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
      now,
      hold: { idempotencyKey: 'hold:booking-version-authority', request },
    });
    const quote = await pricing.quoteHospitalityPrice({ organizationId: organization.id, actorUserId: admin.id, request });
    const booking = await bookings.confirmHospitalityBookingFromHold({
      organizationId: organization.id,
      actorUserId: admin.id,
      now,
      confirmation: {
        holdId: hold.id,
        customerId: customer.id,
        idempotencyKey: 'booking:version-authority',
        expectedPricingFingerprint: quote.fingerprint,
        guests: [{ firstName: 'Version', lastName: 'Guest' }],
      },
    });

    const allocation = await db.hospitalityBookingAllocation.findFirstOrThrow({
      where: { organizationId: organization.id, bookingId: booking.id },
      select: { id: true, createdAt: true },
    });

    await assert.rejects(
      db.hospitalityBooking.update({
        where: { id: booking.id },
        data: { createdAt: new Date('2099-01-01T00:00:00.000Z') },
      }),
      /hospitality booking identity evidence is immutable/i,
    );
    await assert.rejects(
      db.hospitalityBooking.update({
        where: { id: booking.id },
        data: { id: crypto.randomUUID() },
      }),
      /hospitality booking identity evidence is immutable/i,
    );
    await assert.rejects(
      db.hospitalityBookingAllocation.update({
        where: { id: allocation.id },
        data: { createdAt: new Date('2099-01-01T00:00:00.000Z') },
      }),
      /hospitality booking allocation identity and ownership evidence is immutable/i,
    );
    await assert.rejects(
      db.hospitalityBookingAllocation.update({
        where: { id: allocation.id },
        data: { id: crypto.randomUUID() },
      }),
      /hospitality booking allocation identity and ownership evidence is immutable/i,
    );
    await assert.rejects(
      db.hospitalityBookingAllocation.update({
        where: { id: allocation.id },
        data: { bookingId: crypto.randomUUID() },
      }),
      /hospitality booking allocation identity and ownership evidence is immutable/i,
    );

    const versionBeforeDirectWrite = await db.hospitalityBooking.findFirstOrThrow({
      where: { id: booking.id, organizationId: organization.id },
      select: { updatedAt: true },
    });
    const callerAuthoredBookingVersion = new Date('2099-01-01T00:00:00.000Z');
    await db.hospitalityBooking.update({
      where: { id: booking.id },
      data: { updatedAt: callerAuthoredBookingVersion },
    });
    const versionAfterDirectWrite = await db.hospitalityBooking.findFirstOrThrow({
      where: { id: booking.id, organizationId: organization.id },
      select: { updatedAt: true },
    });

    assert.notEqual(
      versionAfterDirectWrite.updatedAt.getTime(),
      callerAuthoredBookingVersion.getTime(),
      'PostgreSQL must replace caller-authored hospitality booking versions',
    );
    assert.ok(
      versionAfterDirectWrite.updatedAt.getTime() > versionBeforeDirectWrite.updatedAt.getTime(),
      'hospitality booking version must advance monotonically',
    );
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