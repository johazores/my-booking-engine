import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) {
  throw new Error('Rental booking integration tests must run through npm run test:database with TEST_DATABASE_URL.');
}

test('rental booking confirmation, reads, cancellation, inventory release, and customer retention are tenant-scoped and atomic', async () => {
  const [{ db }, holds, bookings, bookingReads, cancellations, authority, availability, customers] = await Promise.all([
    import('../database.ts'),
    import('../inventory/rental-hold-service.ts'),
    import('./rental-booking-service.ts'),
    import('./rental-booking-read-service.ts'),
    import('./rental-booking-cancellation-service.ts'),
    import('./rental-booking-authority-service.ts'),
    import('../inventory/rental-availability-service.ts'),
    import('../customers/customer-service.ts'),
  ]);

  const runId = crypto.randomUUID();
  const admin = await db.user.create({
    data: { email: `rental-booking-admin-${runId}@example.test`, status: 'ACTIVE' },
  });
  const otherAdmin = await db.user.create({
    data: { email: `rental-booking-other-admin-${runId}@example.test`, status: 'ACTIVE' },
  });
  const organization = await db.organization.create({
    data: {
      name: 'Rental Booking Tenant',
      slug: `rental-booking-${runId}`.slice(0, 63),
      kind: 'RENTAL_BUSINESS',
      timezone: 'Asia/Manila',
      currency: 'PHP',
    },
  });
  const otherOrganization = await db.organization.create({
    data: {
      name: 'Other Rental Booking Tenant',
      slug: `rental-booking-other-${runId}`.slice(0, 63),
      kind: 'RENTAL_BUSINESS',
      timezone: 'Asia/Manila',
      currency: 'PHP',
    },
  });
  await Promise.all([
    db.organizationMembership.create({
      data: { organizationId: organization.id, userId: admin.id, status: 'ACTIVE', role: 'ADMIN' },
    }),
    db.organizationMembership.create({
      data: { organizationId: otherOrganization.id, userId: otherAdmin.id, status: 'ACTIVE', role: 'ADMIN' },
    }),
  ]);
  const customer = await db.customer.create({
    data: {
      organizationId: organization.id,
      firstName: 'Rental',
      lastName: 'Customer',
      email: `rental-booking-customer-${runId}@example.test`,
      phone: '+639171234567',
      status: 'ACTIVE',
    },
  });
  const location = await db.rentalLocation.create({
    data: {
      organizationId: organization.id,
      name: 'Rental Booking Depot',
      code: `BOOK-${runId.slice(0, 8)}`.toUpperCase(),
      addressLine1: '1 Test Street',
      city: 'Makati',
      countryCode: 'PH',
      timeZone: 'Asia/Manila',
      status: 'ACTIVE',
    },
  });
  const unitType = await db.rentalUnitType.create({
    data: {
      organizationId: organization.id,
      name: 'Rental Booking Bike',
      code: `BIKE-${runId.slice(0, 8)}`.toUpperCase(),
      currency: 'PHP',
      defaultDailyRateMinor: 150000,
      status: 'ACTIVE',
    },
  });
  const unit = await db.rentalUnit.create({
    data: {
      organizationId: organization.id,
      unitTypeId: unitType.id,
      locationId: location.id,
      name: 'Rental Booking Bike 001',
      code: `UNIT-${runId.slice(0, 8)}`.toUpperCase(),
      status: 'ACTIVE',
    },
  });

  try {
    const hold = await holds.createRentalAvailabilityHold({
      organizationId: organization.id,
      actorUserId: admin.id,
      hold: {
        unitId: unit.id,
        startsOn: '2026-10-10',
        endsOn: '2026-10-13',
        idempotencyKey: `rental-booking-hold:${runId}`,
      },
    });

    const reviewed = await authority.reviewRentalBookingConversionAuthority({
      organizationId: organization.id,
      actorUserId: admin.id,
      holdId: hold.id,
      customerId: customer.id,
    });
    assert.equal(reviewed.ready, true);
    assert.match(reviewed.authorityFingerprint ?? '', /^[a-f0-9]{64}$/);

    const attempts = await Promise.allSettled([
      bookings.confirmRentalBookingFromHold({
        organizationId: organization.id,
        actorUserId: admin.id,
        confirmation: {
          holdId: hold.id,
          customerId: customer.id,
          idempotencyKey: `rental-booking-confirm-a:${runId}`,
          authorityFingerprint: reviewed.authorityFingerprint as string,
        },
      }),
      bookings.confirmRentalBookingFromHold({
        organizationId: organization.id,
        actorUserId: admin.id,
        confirmation: {
          holdId: hold.id,
          customerId: customer.id,
          idempotencyKey: `rental-booking-confirm-b:${runId}`,
          authorityFingerprint: reviewed.authorityFingerprint as string,
        },
      }),
    ]);
    const fulfilled = attempts.filter((result) => result.status === 'fulfilled');
    const rejected = attempts.filter((result) => result.status === 'rejected');
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);

    const confirmed = (fulfilled[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof bookings.confirmRentalBookingFromHold>>>).value;
    assert.equal(confirmed.idempotent, false);
    assert.equal(confirmed.booking.organizationId, organization.id);
    assert.equal(confirmed.booking.customerId, customer.id);
    assert.equal(confirmed.booking.customerFirstName, customer.firstName);
    assert.equal(confirmed.booking.customerLastName, customer.lastName);
    assert.equal(confirmed.booking.holdId, hold.id);
    assert.equal(confirmed.booking.unitId, unit.id);
    assert.equal(confirmed.booking.status, 'CONFIRMED');
    assert.equal(confirmed.booking.totalMinor, 450000n);
    assert.equal(confirmed.allocation.unitId, unit.id);

    const detail = await bookingReads.getRentalBooking({
      organizationId: organization.id,
      actorUserId: admin.id,
      bookingId: confirmed.booking.id,
    });
    assert.equal(detail.id, confirmed.booking.id);
    assert.equal(detail.organizationId, organization.id);
    assert.equal(detail.allocation?.id, confirmed.allocation.id);
    assert.equal(detail.customerFirstName, customer.firstName);
    assert.equal(detail.unit.id, unit.id);
    const listed = await bookingReads.listRentalBookings({
      organizationId: organization.id,
      actorUserId: admin.id,
      status: 'CONFIRMED',
      page: 1,
      pageSize: 20,
    });
    assert.equal(listed.total, 1);
    assert.equal(listed.bookings[0]?.id, confirmed.booking.id);
    const otherTenantList = await bookingReads.listRentalBookings({
      organizationId: otherOrganization.id,
      actorUserId: otherAdmin.id,
      status: 'ALL',
      page: 1,
      pageSize: 20,
    });
    assert.equal(otherTenantList.total, 0);
    await assert.rejects(
      bookingReads.getRentalBooking({
        organizationId: otherOrganization.id,
        actorUserId: otherAdmin.id,
        bookingId: confirmed.booking.id,
      }),
      /not available/i,
    );

    const consumed = await db.rentalAvailabilityHold.findUniqueOrThrow({ where: { id: hold.id } });
    assert.equal(consumed.status, 'CONSUMED');
    assert.ok(consumed.endedAt);

    const replay = await bookings.confirmRentalBookingFromHold({
      organizationId: organization.id,
      actorUserId: admin.id,
      confirmation: {
        holdId: hold.id,
        customerId: customer.id,
        idempotencyKey: confirmed.booking.idempotencyKey,
        authorityFingerprint: reviewed.authorityFingerprint as string,
      },
    });
    assert.equal(replay.idempotent, true);
    assert.equal(replay.booking.id, confirmed.booking.id);
    assert.equal(replay.allocation.id, confirmed.allocation.id);

    const bookedSearch = await availability.searchRentalInventoryAvailability({
      organizationId: organization.id,
      actorUserId: admin.id,
      search: {
        unitTypeCode: unitType.code,
        locationCode: location.code,
        startsOn: '2026-10-10',
        endsOn: '2026-10-13',
      },
    });
    assert.equal(bookedSearch.availability.total, 0);

    await assert.rejects(
      holds.createRentalAvailabilityHold({
        organizationId: organization.id,
        actorUserId: admin.id,
        hold: {
          unitId: unit.id,
          startsOn: '2026-10-11',
          endsOn: '2026-10-12',
          idempotencyKey: `rental-booking-overlap:${runId}`,
        },
      }),
      /booking/i,
    );

    await assert.rejects(
      db.rentalAvailabilityBlock.create({
        data: {
          organizationId: organization.id,
          unitId: unit.id,
          startsOn: new Date('2026-10-11T00:00:00.000Z'),
          endsOn: new Date('2026-10-12T00:00:00.000Z'),
          reason: 'must not overlap confirmed booking',
        },
      }),
      /booking/i,
    );

    await assert.rejects(
      cancellations.cancelRentalBooking({
        organizationId: otherOrganization.id,
        actorUserId: otherAdmin.id,
        bookingId: confirmed.booking.id,
      }),
      /not available/i,
    );

    const cancelled = await cancellations.cancelRentalBooking({
      organizationId: organization.id,
      actorUserId: admin.id,
      bookingId: confirmed.booking.id,
    });
    assert.equal(cancelled.idempotent, false);
    assert.equal(cancelled.booking.status, 'CANCELLED');
    assert.ok(cancelled.booking.cancelledAt);
    assert.equal(cancelled.allocation.id, confirmed.allocation.id);

    const cancellationReplay = await cancellations.cancelRentalBooking({
      organizationId: organization.id,
      actorUserId: admin.id,
      bookingId: confirmed.booking.id,
    });
    assert.equal(cancellationReplay.idempotent, true);
    assert.equal(cancellationReplay.booking.status, 'CANCELLED');
    assert.equal(cancellationReplay.allocation.id, confirmed.allocation.id);

    await assert.rejects(
      db.rentalBooking.update({
        where: { id: confirmed.booking.id },
        data: { status: 'CONFIRMED', cancelledAt: null },
      }),
      /unsupported rental booking lifecycle transition/i,
    );

    const cancelledDetail = await bookingReads.getRentalBooking({
      organizationId: organization.id,
      actorUserId: admin.id,
      bookingId: confirmed.booking.id,
    });
    assert.equal(cancelledDetail.status, 'CANCELLED');
    assert.equal(cancelledDetail.allocation?.id, confirmed.allocation.id);
    const cancelledList = await bookingReads.listRentalBookings({
      organizationId: organization.id,
      actorUserId: admin.id,
      status: 'CANCELLED',
      page: 1,
      pageSize: 20,
    });
    assert.equal(cancelledList.total, 1);
    const confirmedAfterCancellation = await bookingReads.listRentalBookings({
      organizationId: organization.id,
      actorUserId: admin.id,
      status: 'CONFIRMED',
      page: 1,
      pageSize: 20,
    });
    assert.equal(confirmedAfterCancellation.total, 0);

    const releasedSearch = await availability.searchRentalInventoryAvailability({
      organizationId: organization.id,
      actorUserId: admin.id,
      search: {
        unitTypeCode: unitType.code,
        locationCode: location.code,
        startsOn: '2026-10-10',
        endsOn: '2026-10-13',
      },
    });
    assert.equal(releasedSearch.availability.total, 1);

    const replacementHold = await holds.createRentalAvailabilityHold({
      organizationId: organization.id,
      actorUserId: admin.id,
      hold: {
        unitId: unit.id,
        startsOn: '2026-10-11',
        endsOn: '2026-10-12',
        idempotencyKey: `rental-booking-after-cancel:${runId}`,
      },
    });
    assert.equal(replacementHold.status, 'ACTIVE');
    await holds.releaseRentalAvailabilityHold({
      organizationId: organization.id,
      actorUserId: admin.id,
      holdId: replacementHold.id,
    });

    await customers.archiveCustomer({
      organizationId: organization.id,
      actorUserId: admin.id,
      customerId: customer.id,
      confirmation: 'ARCHIVE',
    });
    const archivedCustomer = await customers.readCustomerWithActivity({
      organizationId: organization.id,
      actorUserId: admin.id,
      customerId: customer.id,
    });
    assert.equal(archivedCustomer?.deidentificationEligibility.allowed, false);
    assert.equal(archivedCustomer?.deidentificationEligibility.reason, 'BOOKING_REFERENCES');
    await assert.rejects(
      customers.deidentifyCustomerProfile({
        organizationId: organization.id,
        actorUserId: admin.id,
        customerId: customer.id,
        confirmation: 'DEIDENTIFY',
      }),
      /booking records/i,
    );
    await assert.rejects(
      db.customer.delete({ where: { id: customer.id } }),
      /foreign key|constraint/i,
    );
  } finally {
    await db.auditEvent.deleteMany({ where: { organizationId: organization.id } });
    await db.rentalBookingAllocation.deleteMany({ where: { organizationId: organization.id } });
    await db.rentalBooking.deleteMany({ where: { organizationId: organization.id } });
    await db.rentalAvailabilityBlock.deleteMany({ where: { organizationId: organization.id } });
    await db.rentalAvailabilityHold.deleteMany({ where: { organizationId: organization.id } });
    await db.rentalRatePeriod.deleteMany({ where: { organizationId: organization.id } });
    await db.rentalUnit.deleteMany({ where: { organizationId: organization.id } });
    await db.rentalUnitType.deleteMany({ where: { organizationId: organization.id } });
    await db.rentalLocation.deleteMany({ where: { organizationId: organization.id } });
    await db.customer.deleteMany({ where: { organizationId: organization.id } });
    await db.organizationMembership.deleteMany({ where: { organizationId: { in: [organization.id, otherOrganization.id] } } });
    await db.organization.deleteMany({ where: { id: { in: [organization.id, otherOrganization.id] } } });
    await db.user.deleteMany({ where: { id: { in: [admin.id, otherAdmin.id] } } });
  }
});
