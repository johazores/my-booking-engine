import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) {
  throw new Error('Rental booking source-evidence integration tests must run through npm run test:database with TEST_DATABASE_URL.');
}

test('confirmed rental bookings retain immutable source-hold evidence', async () => {
  const [{ db }, holds, authority, bookings, cancellation] = await Promise.all([
    import('../database.ts'),
    import('../inventory/rental-hold-service.ts'),
    import('./rental-booking-authority-service.ts'),
    import('./rental-booking-service.ts'),
    import('./rental-booking-cancellation-service.ts'),
  ]);

  const runId = crypto.randomUUID();
  const admin = await db.user.create({
    data: { email: `rental-source-evidence-${runId}@example.test`, status: 'ACTIVE' },
  });
  const organization = await db.organization.create({
    data: {
      name: 'Rental Source Evidence Tenant',
      slug: `rental-source-evidence-${runId}`.slice(0, 63),
      kind: 'RENTAL_BUSINESS',
      timezone: 'Asia/Manila',
      currency: 'PHP',
    },
  });
  await db.organizationMembership.create({
    data: { organizationId: organization.id, userId: admin.id, status: 'ACTIVE', role: 'ADMIN' },
  });
  const customer = await db.customer.create({
    data: {
      organizationId: organization.id,
      firstName: 'Source',
      lastName: 'Evidence',
      email: `rental-source-customer-${runId}@example.test`,
      status: 'ACTIVE',
    },
  });
  const location = await db.rentalLocation.create({
    data: {
      organizationId: organization.id,
      name: 'Source Evidence Depot',
      code: `SED-${runId.slice(0, 8)}`.toUpperCase(),
      addressLine1: '1 Evidence Street',
      city: 'Makati',
      countryCode: 'PH',
      timeZone: 'Asia/Manila',
      status: 'ACTIVE',
    },
  });
  const unitType = await db.rentalUnitType.create({
    data: {
      organizationId: organization.id,
      name: 'Source Evidence Bike',
      code: `SEB-${runId.slice(0, 8)}`.toUpperCase(),
      currency: 'PHP',
      defaultDailyRateMinor: 125000,
      status: 'ACTIVE',
    },
  });
  const unit = await db.rentalUnit.create({
    data: {
      organizationId: organization.id,
      unitTypeId: unitType.id,
      locationId: location.id,
      name: 'Source Evidence Unit',
      code: `SEU-${runId.slice(0, 8)}`.toUpperCase(),
      status: 'ACTIVE',
    },
  });

  try {
    const hold = await holds.createRentalAvailabilityHold({
      organizationId: organization.id,
      actorUserId: admin.id,
      hold: {
        unitId: unit.id,
        startsOn: '2026-11-10',
        endsOn: '2026-11-13',
        idempotencyKey: `rental-source-hold:${runId}`,
      },
    });
    const review = await authority.reviewRentalBookingConversionAuthority({
      organizationId: organization.id,
      actorUserId: admin.id,
      holdId: hold.id,
      customerId: customer.id,
    });
    assert.equal(review.ready, true);

    const confirmed = await bookings.confirmRentalBookingFromHold({
      organizationId: organization.id,
      actorUserId: admin.id,
      confirmation: {
        holdId: hold.id,
        customerId: customer.id,
        idempotencyKey: `rental-source-confirm:${runId}`,
        authorityFingerprint: review.authorityFingerprint as string,
      },
    });
    assert.equal(confirmed.idempotent, false);

    await assert.rejects(
      db.rentalAvailabilityHold.update({
        where: { id: hold.id },
        data: { endsOn: new Date('2026-11-14T00:00:00.000Z') },
      }),
      /source hold evidence is immutable after confirmation/i,
    );

    await assert.rejects(
      db.rentalBookingAllocation.update({
        where: { id: confirmed.allocation.id },
        data: { bookingId: crypto.randomUUID() },
      }),
      /rental booking allocation ownership is immutable/i,
    );

    await assert.rejects(
      db.rentalBookingAllocation.delete({ where: { id: confirmed.allocation.id } }),
      /rental booking must retain physical allocation evidence/i,
    );

    const cancelled = await cancellation.cancelRentalBooking({
      organizationId: organization.id,
      actorUserId: admin.id,
      bookingId: confirmed.booking.id,
      reason: 'Source evidence retention regression',
    });
    assert.equal(cancelled.booking.status, 'CANCELLED');

    await assert.rejects(
      db.rentalBookingAllocation.delete({ where: { id: confirmed.allocation.id } }),
      /rental booking must retain physical allocation evidence/i,
    );

    const secondHold = await holds.createRentalAvailabilityHold({
      organizationId: organization.id,
      actorUserId: admin.id,
      hold: {
        unitId: unit.id,
        startsOn: '2026-11-20',
        endsOn: '2026-11-22',
        idempotencyKey: `rental-source-second-hold:${runId}`,
      },
    });

    await assert.rejects(
      db.rentalAvailabilityHold.update({
        where: { id: secondHold.id },
        data: { status: 'CONSUMED', endedAt: new Date() },
      }),
      /consumed rental hold must be retained by a rental booking/i,
    );

    await assert.rejects(
      db.$transaction(async (transaction) => {
        const consumedSecondHold = await transaction.rentalAvailabilityHold.update({
          where: { id: secondHold.id },
          data: { status: 'CONSUMED', endedAt: new Date() },
        });
        assert.ok(consumedSecondHold.quotedCurrency);
        assert.ok(consumedSecondHold.quotedTotalMinor);
        assert.ok(consumedSecondHold.pricingFingerprint);

        await transaction.rentalBooking.create({
          data: {
            organizationId: organization.id,
            customerId: customer.id,
            customerFirstName: customer.firstName,
            customerLastName: customer.lastName,
            customerEmail: customer.email,
            customerPhone: customer.phone,
            holdId: consumedSecondHold.id,
            unitId: unit.id,
            unitTypeId: unitType.id,
            locationId: location.id,
            idempotencyKey: `rental-source-direct:${runId}`,
            status: 'CONFIRMED',
            startsOn: consumedSecondHold.startsOn,
            endsOn: consumedSecondHold.endsOn,
            currency: consumedSecondHold.quotedCurrency as string,
            totalMinor: consumedSecondHold.quotedTotalMinor as bigint,
            pricingFingerprint: consumedSecondHold.pricingFingerprint as string,
            pricingSnapshot: { tampered: true },
            pricingObservedAt: new Date(),
            authorityFingerprint: 'a'.repeat(64),
            confirmedAt: new Date(),
          },
        });
      }),
      /pricing snapshot must match retained source hold evidence/i,
    );
  } finally {
    await db.$transaction(async (transaction) => {
      await transaction.rentalBookingAllocation.deleteMany({ where: { organizationId: organization.id } });
      await transaction.auditEvent.deleteMany({ where: { organizationId: organization.id } });
      await transaction.rentalBooking.deleteMany({ where: { organizationId: organization.id } });
      await transaction.rentalAvailabilityHold.deleteMany({ where: { organizationId: organization.id } });
    });
    await db.rentalUnit.deleteMany({ where: { organizationId: organization.id } });
    await db.rentalUnitType.deleteMany({ where: { organizationId: organization.id } });
    await db.rentalLocation.deleteMany({ where: { organizationId: organization.id } });
    await db.customer.deleteMany({ where: { organizationId: organization.id } });
    await db.organizationMembership.deleteMany({ where: { organizationId: organization.id } });
    await db.organization.delete({ where: { id: organization.id } });
    await db.user.delete({ where: { id: admin.id } });
  }
});
