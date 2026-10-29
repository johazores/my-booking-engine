import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) throw new Error('Hospitality booking guest modification integration tests must run through npm run test:database with TEST_DATABASE_URL.');

test('traveler edits are tenant-safe, idempotent, capacity-bound, and audit-minimized', async () => {
  const [{ db }, guestModifications, audit] = await Promise.all([
    import('../database.ts'),
    import('./hospitality-booking-guest-modification-service.ts'),
    import('./hospitality-booking-audit-service.ts'),
  ]);
  const runId = crypto.randomUUID();
  const userIds = Array.from({ length: 3 }, () => crypto.randomUUID());
  const organizationIds = Array.from({ length: 2 }, () => crypto.randomUUID());
  try {
    const databaseClock = await db.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    const currentTime = databaseClock[0]?.now;
    assert.ok(currentTime instanceof Date, 'PostgreSQL clock is required for future booking fixtures');
    const dateAt = (days: number) => new Date(currentTime.getTime() + days * 86_400_000);
    const adminA = await db.user.create({ data: { id: userIds[0], email: `guest-edit-admin-a-${runId}@example.test`, status: 'ACTIVE' } });
    const staffA = await db.user.create({ data: { id: userIds[1], email: `guest-edit-staff-a-${runId}@example.test`, status: 'ACTIVE' } });
    const adminB = await db.user.create({ data: { id: userIds[2], email: `guest-edit-admin-b-${runId}@example.test`, status: 'ACTIVE' } });
    const organizationA = await db.organization.create({ data: { id: organizationIds[0], name: 'Guest Edit Tenant A', slug: `guest-edit-a-${runId}`.slice(0, 63), kind: 'HOTEL', currency: 'USD' } });
    const organizationB = await db.organization.create({ data: { id: organizationIds[1], name: 'Guest Edit Tenant B', slug: `guest-edit-b-${runId}`.slice(0, 63), kind: 'HOTEL', currency: 'USD' } });
    await db.organizationMembership.createMany({ data: [
      { organizationId: organizationA.id, userId: adminA.id, status: 'ACTIVE', role: 'ADMIN' },
      { organizationId: organizationA.id, userId: staffA.id, status: 'ACTIVE', role: 'STAFF' },
      { organizationId: organizationB.id, userId: adminB.id, status: 'ACTIVE', role: 'ADMIN' },
    ] });
    const customer = await db.customer.create({ data: { organizationId: organizationA.id, firstName: 'Initial', lastName: 'Customer', email: `customer-${runId}@example.test` } });
    const property = await db.hospitalityProperty.create({ data: { organizationId: organizationA.id, name: 'Guest Edit Hotel', code: `GE${runId.slice(0, 6)}`.toUpperCase(), timezone: 'UTC', countryCode: 'US' } });
    const roomType = await db.hospitalityRoomType.create({ data: { organizationId: organizationA.id, propertyId: property.id, name: 'Double', code: 'DOUBLE', maxOccupancy: 2 } });
    const ratePlan = await db.hospitalityRatePlan.create({ data: { organizationId: organizationA.id, propertyId: property.id, name: 'Flexible', code: 'FLEX' } });
    await db.hospitalityRoomTypeRatePlan.create({ data: { organizationId: organizationA.id, propertyId: property.id, roomTypeId: roomType.id, ratePlanId: ratePlan.id } });
    const hold = await db.hospitalityAvailabilityHold.create({ data: {
      organizationId: organizationA.id,
      propertyId: property.id,
      roomTypeId: roomType.id,
      ratePlanId: ratePlan.id,
      idempotencyKey: `guest-edit-hold:${runId}`,
      arrivalDate: dateAt(9),
      departureDate: dateAt(11),
      quantity: 1,
      status: 'CONSUMED',
      expiresAt: dateAt(9),
      endedAt: dateAt(0),
    } });
    const booking = await db.hospitalityBooking.create({ data: {
      organizationId: organizationA.id,
      propertyId: property.id,
      roomTypeId: roomType.id,
      ratePlanId: ratePlan.id,
      customerId: customer.id,
      holdId: hold.id,
      idempotencyKey: `guest-edit-booking:${runId}`,
      status: 'CONFIRMED',
      paymentStatus: 'UNPAID',
      arrivalDate: dateAt(9),
      departureDate: dateAt(11),
      quantity: 1,
      currency: 'USD',
      accommodationSubtotalMinor: 20_000n,
      taxTotalMinor: 0n,
      feeTotalMinor: 0n,
      addonTotalMinor: 0n,
      totalMinor: 20_000n,
      pricingFingerprint: 'a'.repeat(64),
      addonSelections: [],
      confirmedAt: dateAt(0),
    } });
    await db.hospitalityBookingAllocation.create({ data: {
      organizationId: organizationA.id,
      bookingId: booking.id,
      propertyId: property.id,
      roomTypeId: roomType.id,
      arrivalDate: booking.arrivalDate,
      departureDate: booking.departureDate,
      quantity: 1,
    } });
    await db.hospitalityBookingGuest.createMany({ data: [
      { organizationId: organizationA.id, bookingId: booking.id, position: 0, firstName: 'Ada', lastName: 'Original', email: 'ada.original@example.test' },
    ] });

    const firstChange = {
      idempotencyKey: 'guest-edit:integration-1',
      guests: [
        { firstName: 'Ada', lastName: 'Updated', email: 'ADA.UPDATED@EXAMPLE.TEST' },
        { firstName: 'Grace', lastName: 'Hopper', email: null },
      ],
    };

    await assert.rejects(guestModifications.updateHospitalityBookingGuests({ organizationId: organizationA.id, actorUserId: staffA.id, bookingId: booking.id, change: firstChange }), /permission/i);
    await assert.rejects(guestModifications.updateHospitalityBookingGuests({ organizationId: organizationB.id, actorUserId: adminB.id, bookingId: booking.id, change: firstChange }), /not available/i);
    await assert.rejects(guestModifications.updateHospitalityBookingGuests({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      bookingId: booking.id,
      change: { ...firstChange, idempotencyKey: 'guest-edit:too-many', guests: [...firstChange.guests, { firstName: 'Third', lastName: 'Guest', email: null }] },
    }), /reserved occupancy of 2/i);

    const changed = await guestModifications.updateHospitalityBookingGuests({ organizationId: organizationA.id, actorUserId: adminA.id, bookingId: booking.id, change: firstChange });
    assert.deepEqual(changed.guests, [
      { firstName: 'Ada', lastName: 'Updated', email: 'ada.updated@example.test' },
      { firstName: 'Grace', lastName: 'Hopper', email: null },
    ]);
    assert.equal(changed.maximumGuests, 2);
    assert.equal(await db.hospitalityBookingGuest.count({ where: { organizationId: organizationA.id, bookingId: booking.id } }), 2);

    const exactRetry = await guestModifications.updateHospitalityBookingGuests({ organizationId: organizationA.id, actorUserId: adminA.id, bookingId: booking.id, change: firstChange });
    assert.deepEqual(exactRetry.guests, changed.guests);
    assert.equal(await db.auditEvent.count({ where: { organizationId: organizationA.id, resourceId: booking.id, action: 'booking.guests.updated' } }), 1);

    await assert.rejects(guestModifications.updateHospitalityBookingGuests({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      bookingId: booking.id,
      change: { idempotencyKey: firstChange.idempotencyKey, guests: [{ firstName: 'Different', lastName: 'Payload', email: null }] },
    }), /different traveler update/i);

    const secondChange = { idempotencyKey: 'guest-edit:integration-2', guests: [{ firstName: 'Katherine', lastName: 'Johnson', email: 'kj@example.test' }] };
    await guestModifications.updateHospitalityBookingGuests({ organizationId: organizationA.id, actorUserId: adminA.id, bookingId: booking.id, change: secondChange });
    await assert.rejects(guestModifications.updateHospitalityBookingGuests({ organizationId: organizationA.id, actorUserId: adminA.id, bookingId: booking.id, change: firstChange }), /changed again afterward/i);

    const storedGuests = await db.hospitalityBookingGuest.findMany({ where: { organizationId: organizationA.id, bookingId: booking.id }, orderBy: { position: 'asc' } });
    assert.equal(storedGuests.length, 1);
    assert.equal(storedGuests[0]?.firstName, 'Katherine');

    const auditPage = await audit.listHospitalityBookingAuditEvents({ organizationId: organizationA.id, actorUserId: staffA.id, bookingId: booking.id, page: 1, pageSize: 1 });
    assert.equal(auditPage.total, 2);
    assert.equal(auditPage.events.length, 1);
    assert.equal(auditPage.totalPages, 2);
    await assert.rejects(audit.listHospitalityBookingAuditEvents({ organizationId: organizationB.id, actorUserId: adminB.id, bookingId: booking.id }), /not available/i);

    const events = await db.auditEvent.findMany({ where: { organizationId: organizationA.id, resourceId: booking.id, action: 'booking.guests.updated' } });
    assert.equal(events.length, 2);
    const serializedAudit = JSON.stringify(events.map((event) => ({ beforeData: event.beforeData, afterData: event.afterData })));
    assert.equal(serializedAudit.includes('ada.updated@example.test'), false);
    assert.equal(serializedAudit.includes('Katherine'), false);
  } finally {
    try {
      await db.auditEvent.deleteMany({ where: { organizationId: { in: [organizationIds[0], organizationIds[1]] } } });
      await db.$transaction(async (transaction) => {
        await transaction.hospitalityBookingGuest.deleteMany({ where: { organizationId: { in: [organizationIds[0], organizationIds[1]] } } });
        await transaction.hospitalityBookingAllocation.deleteMany({ where: { organizationId: { in: [organizationIds[0], organizationIds[1]] } } });
        await transaction.hospitalityBooking.deleteMany({ where: { organizationId: { in: [organizationIds[0], organizationIds[1]] } } });
      });
      await db.hospitalityAvailabilityHold.deleteMany({ where: { organizationId: { in: [organizationIds[0], organizationIds[1]] } } });
      await db.hospitalityRoomTypeRatePlan.deleteMany({ where: { organizationId: { in: [organizationIds[0], organizationIds[1]] } } });
      await db.hospitalityRatePlan.deleteMany({ where: { organizationId: { in: [organizationIds[0], organizationIds[1]] } } });
      await db.hospitalityRoomType.deleteMany({ where: { organizationId: { in: [organizationIds[0], organizationIds[1]] } } });
      await db.hospitalityProperty.deleteMany({ where: { organizationId: { in: [organizationIds[0], organizationIds[1]] } } });
      await db.customer.deleteMany({ where: { organizationId: { in: [organizationIds[0], organizationIds[1]] } } });
      await db.organizationMembership.deleteMany({ where: { organizationId: { in: [organizationIds[0], organizationIds[1]] } } });
      await db.organization.deleteMany({ where: { id: { in: [organizationIds[0], organizationIds[1]] } } });
      await db.user.deleteMany({ where: { id: { in: [userIds[0], userIds[1], userIds[2]] } } });
    } finally {
      await db.$disconnect();
    }
  }
});