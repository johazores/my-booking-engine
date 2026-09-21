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
  const admin = await db.user.create({ data: { email: `cancelled-allocation-admin-${runId}@example.test`, status: 'ACTIVE' } });
  const organization = await db.organization.create({
    data: { name: 'Cancelled Allocation Tenant', slug: `cancelled-allocation-${runId}`.slice(0, 63), kind: 'HOTEL', currency: 'USD' },
  });
  await db.organizationMembership.create({
    data: { organizationId: organization.id, userId: admin.id, status: 'ACTIVE', role: 'ADMIN' },
  });

  try {
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
        startDate: '2026-09-01',
        endDate: '2026-09-30',
        amount: '100.00',
      },
    });

    const confirmationNow = new Date('2026-09-01T00:00:00.000Z');
    const request = {
      propertyId: property.id,
      roomTypeId: roomType.id,
      ratePlanId: ratePlan.id,
      arrivalDate: '2026-09-10',
      departureDate: '2026-09-12',
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

    await db.hospitalityBookingAllocation.update({
      where: { id: allocation.id },
      data: { quantity: 2 },
    });

    await assert.rejects(
      cancellation.cancelHospitalityBooking({
        organizationId: organization.id,
        actorUserId: admin.id,
        bookingId: booking.id,
        now: new Date('2026-09-02T00:00:00.000Z'),
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
      now: new Date('2026-09-02T00:00:00.000Z'),
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
        data: { departureDate: new Date('2026-09-13T00:00:00.000Z') },
      }),
      /cancelled hospitality booking allocation history is immutable/i,
    );

    const replay = await cancellation.cancelHospitalityBooking({
      organizationId: organization.id,
      actorUserId: admin.id,
      bookingId: booking.id,
      now: new Date('2026-09-03T00:00:00.000Z'),
    });
    assert.equal(replay.status, 'CANCELLED');
  } finally {
    await db.auditEvent.deleteMany({ where: { organizationId: organization.id } });
    await db.hospitalityBookingPricingEvidence.deleteMany({ where: { organizationId: organization.id } });
    await db.hospitalityBookingGuest.deleteMany({ where: { organizationId: organization.id } });
    await db.hospitalityBookingAllocation.deleteMany({ where: { organizationId: organization.id } });
    await db.hospitalityBooking.deleteMany({ where: { organizationId: organization.id } });
    await db.hospitalityAvailabilityHold.deleteMany({ where: { organizationId: organization.id } });
    await db.hospitalityBaseRate.deleteMany({ where: { organizationId: organization.id } });
    await db.hospitalityRoomTypeRatePlan.deleteMany({ where: { organizationId: organization.id } });
    await db.hospitalityRatePlan.deleteMany({ where: { organizationId: organization.id } });
    await db.hospitalityRoom.deleteMany({ where: { organizationId: organization.id } });
    await db.hospitalityRoomType.deleteMany({ where: { organizationId: organization.id } });
    await db.hospitalityProperty.deleteMany({ where: { organizationId: organization.id } });
    await db.customer.deleteMany({ where: { organizationId: organization.id } });
    await db.organizationMembership.deleteMany({ where: { organizationId: organization.id } });
    await db.organization.delete({ where: { id: organization.id } });
    await db.user.delete({ where: { id: admin.id } });
  }
});
