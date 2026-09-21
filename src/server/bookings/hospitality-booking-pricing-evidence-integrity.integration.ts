import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) {
  throw new Error('Hospitality booking pricing-evidence integrity tests must run through npm run test:database with TEST_DATABASE_URL.');
}

test('hospitality pricing evidence stays append-only while its booking is retained', async () => {
  const [{ db }, holds, bookings, cancellation, pricing] = await Promise.all([
    import('../database.ts'),
    import('../availability/hospitality-availability-hold-service.ts'),
    import('./hospitality-booking-service.ts'),
    import('./hospitality-booking-cancellation-service.ts'),
    import('../pricing/hospitality-pricing-service.ts'),
  ]);

  const runId = crypto.randomUUID();
  const admin = await db.user.create({ data: { email: `pricing-evidence-admin-${runId}@example.test`, status: 'ACTIVE' } });
  const organization = await db.organization.create({
    data: { name: 'Pricing Evidence Tenant', slug: `pricing-evidence-${runId}`.slice(0, 63), kind: 'HOTEL', currency: 'USD' },
  });
  await db.organizationMembership.create({
    data: { organizationId: organization.id, userId: admin.id, status: 'ACTIVE', role: 'ADMIN' },
  });

  try {
    const customer = await db.customer.create({
      data: { organizationId: organization.id, firstName: 'Evidence', lastName: 'Customer', email: `pricing-evidence-${runId}@example.test` },
    });
    const property = await db.hospitalityProperty.create({
      data: { organizationId: organization.id, name: 'Pricing Evidence Hotel', code: 'PRICEEV', timezone: 'UTC', countryCode: 'US' },
    });
    const roomType = await db.hospitalityRoomType.create({
      data: { organizationId: organization.id, propertyId: property.id, name: 'Pricing Evidence Room', code: 'PRICEEV', maxOccupancy: 2 },
    });
    await db.hospitalityRoom.create({
      data: { organizationId: organization.id, propertyId: property.id, roomTypeId: roomType.id, code: 'PE101' },
    });
    const ratePlan = await db.hospitalityRatePlan.create({
      data: { organizationId: organization.id, propertyId: property.id, name: 'Pricing Evidence Rate', code: 'PRICEEV' },
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
      hold: { idempotencyKey: 'hold:pricing-evidence-integrity', request },
    });
    const quote = await pricing.quoteHospitalityPrice({ organizationId: organization.id, actorUserId: admin.id, request });
    const booking = await bookings.confirmHospitalityBookingFromHold({
      organizationId: organization.id,
      actorUserId: admin.id,
      now: confirmationNow,
      confirmation: {
        holdId: hold.id,
        customerId: customer.id,
        idempotencyKey: 'booking:pricing-evidence-integrity',
        expectedPricingFingerprint: quote.fingerprint,
        guests: [{ firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.test' }],
      },
    });

    const evidence = await db.hospitalityBookingPricingEvidence.findFirstOrThrow({
      where: { organizationId: organization.id, bookingId: booking.id, source: 'BOOKING_CONFIRMATION' },
    });
    const originalEvidenceKey = evidence.evidenceKey;

    await assert.rejects(
      db.hospitalityBookingPricingEvidence.update({
        where: { id: evidence.id },
        data: { evidenceKey: `rewritten:${runId}` },
      }),
      /hospitality booking pricing evidence is immutable/i,
    );

    await assert.rejects(
      db.hospitalityBookingPricingEvidence.delete({ where: { id: evidence.id } }),
      /hospitality booking pricing evidence is append-only while the booking is retained/i,
    );

    assert.equal(
      (await db.hospitalityBookingPricingEvidence.findUniqueOrThrow({ where: { id: evidence.id } })).evidenceKey,
      originalEvidenceKey,
    );

    const cancelled = await cancellation.cancelHospitalityBooking({
      organizationId: organization.id,
      actorUserId: admin.id,
      bookingId: booking.id,
      now: new Date('2026-09-02T00:00:00.000Z'),
    });
    assert.equal(cancelled.status, 'CANCELLED');

    await assert.rejects(
      db.hospitalityBookingPricingEvidence.delete({ where: { id: evidence.id } }),
      /hospitality booking pricing evidence is append-only while the booking is retained/i,
    );
    assert.equal(
      await db.hospitalityBookingPricingEvidence.count({ where: { organizationId: organization.id, bookingId: booking.id } }),
      1,
    );
  } finally {
    await db.auditEvent.deleteMany({ where: { organizationId: organization.id } });
    await db.$transaction(async (transaction) => {
      await transaction.hospitalityBookingPricingEvidence.deleteMany({ where: { organizationId: organization.id } });
      await transaction.hospitalityBookingGuest.deleteMany({ where: { organizationId: organization.id } });
      await transaction.hospitalityBookingAllocation.deleteMany({ where: { organizationId: organization.id } });
      await transaction.hospitalityBooking.deleteMany({ where: { organizationId: organization.id } });
    });
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
