import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) throw new Error('Hospitality booking integration tests must run through npm run test:database with TEST_DATABASE_URL.');

const fingerprint = 'a'.repeat(64);

function snapshot() {
  return {
    currency: 'USD',
    accommodationSubtotalMinor: '20000',
    taxTotalMinor: '2400',
    feeTotalMinor: '500',
    addonTotalMinor: '1200',
    totalMinor: '24100',
    pricingFingerprint: fingerprint,
  };
}

test('booking confirmation consumes a hold into tenant-safe permanent allocation idempotently', async () => {
  const [{ db }, holds, bookings, availability] = await Promise.all([
    import('../database.ts'),
    import('../availability/hospitality-availability-hold-service.ts'),
    import('./hospitality-booking-service.ts'),
    import('../availability/hospitality-availability-service.ts'),
  ]);
  const runId = crypto.randomUUID();
  const adminA = await db.user.create({ data: { email: `booking-admin-a-${runId}@example.test`, status: 'ACTIVE' } });
  const staffA = await db.user.create({ data: { email: `booking-staff-a-${runId}@example.test`, status: 'ACTIVE' } });
  const adminB = await db.user.create({ data: { email: `booking-admin-b-${runId}@example.test`, status: 'ACTIVE' } });
  const organizationA = await db.organization.create({ data: { name: 'Booking Tenant A', slug: `booking-a-${runId}`.slice(0, 63), kind: 'HOTEL', currency: 'USD' } });
  const organizationB = await db.organization.create({ data: { name: 'Booking Tenant B', slug: `booking-b-${runId}`.slice(0, 63), kind: 'HOTEL', currency: 'USD' } });
  await db.organizationMembership.createMany({ data: [
    { organizationId: organizationA.id, userId: adminA.id, status: 'ACTIVE', role: 'ADMIN' },
    { organizationId: organizationA.id, userId: staffA.id, status: 'ACTIVE', role: 'STAFF' },
    { organizationId: organizationB.id, userId: adminB.id, status: 'ACTIVE', role: 'ADMIN' },
  ] });

  try {
    const customer = await db.customer.create({ data: { organizationId: organizationA.id, firstName: 'Ada', lastName: 'Guest', email: `guest-${runId}@example.test` } });
    const property = await db.hospitalityProperty.create({ data: { organizationId: organizationA.id, name: 'Booking Hotel', code: 'BOOK', timezone: 'UTC', countryCode: 'US' } });
    const roomType = await db.hospitalityRoomType.create({ data: { organizationId: organizationA.id, propertyId: property.id, name: 'Only Room', code: 'ONLY', maxOccupancy: 2 } });
    await db.hospitalityRoom.create({ data: { organizationId: organizationA.id, propertyId: property.id, roomTypeId: roomType.id, code: '101' } });
    const ratePlan = await db.hospitalityRatePlan.create({ data: { organizationId: organizationA.id, propertyId: property.id, name: 'Flexible', code: 'FLEX' } });
    await db.hospitalityRoomTypeRatePlan.create({ data: { organizationId: organizationA.id, propertyId: property.id, roomTypeId: roomType.id, ratePlanId: ratePlan.id } });
    const now = new Date('2026-09-01T00:00:00.000Z');
    const request = { propertyId: property.id, roomTypeId: roomType.id, ratePlanId: ratePlan.id, arrivalDate: '2026-09-10', departureDate: '2026-09-12', quantity: 1 };
    const hold = await holds.createHospitalityAvailabilityHold({ organizationId: organizationA.id, actorUserId: adminA.id, now, hold: { idempotencyKey: 'hold:booking-confirm', request } });
    const confirmation = { holdId: hold.id, customerId: customer.id, idempotencyKey: 'booking:confirm-1', expectedPricingFingerprint: fingerprint };

    await assert.rejects(
      bookings.confirmHospitalityBookingFromHold({ organizationId: organizationA.id, actorUserId: staffA.id, confirmation, priceSnapshot: snapshot(), now }),
      /permission/i,
    );
    await assert.rejects(
      bookings.confirmHospitalityBookingFromHold({ organizationId: organizationB.id, actorUserId: adminB.id, confirmation, priceSnapshot: snapshot(), now }),
      /not available/i,
    );

    const created = await bookings.confirmHospitalityBookingFromHold({ organizationId: organizationA.id, actorUserId: adminA.id, confirmation, priceSnapshot: snapshot(), now });
    assert.equal(created.status, 'CONFIRMED');
    assert.equal(created.paymentStatus, 'UNPAID');
    assert.equal(created.totalMinor.toString(), '24100');
    assert.equal(created.allocation?.quantity, 1);

    const consumed = await db.hospitalityAvailabilityHold.findUniqueOrThrow({ where: { id: hold.id } });
    assert.equal(consumed.status, 'CONSUMED');
    assert.equal(consumed.endedAt?.getTime(), now.getTime());

    const retry = await bookings.confirmHospitalityBookingFromHold({ organizationId: organizationA.id, actorUserId: adminA.id, confirmation, priceSnapshot: snapshot(), now });
    assert.equal(retry.id, created.id);
    await assert.rejects(
      bookings.confirmHospitalityBookingFromHold({ organizationId: organizationA.id, actorUserId: adminA.id, confirmation: { ...confirmation, customerId: crypto.randomUUID() }, priceSnapshot: snapshot(), now }),
      /different booking confirmation request/i,
    );
    await assert.rejects(
      bookings.confirmHospitalityBookingFromHold({ organizationId: organizationA.id, actorUserId: adminA.id, confirmation: { ...confirmation, idempotencyKey: 'booking:other-key' }, priceSnapshot: snapshot(), now }),
      /no longer active and unexpired|already been consumed/i,
    );

    const afterBooking = await availability.readHospitalityAvailability({ organizationId: organizationA.id, actorUserId: staffA.id, now, request });
    assert.equal(afterBooking.capacity.activeHoldCount, 0);
    assert.equal(afterBooking.capacity.bookingAllocationCount, 1);
    assert.equal(afterBooking.capacity.allocatedUnits, 1);
    assert.equal(afterBooking.capacity.sellableUnits, 0);
    assert.equal(afterBooking.available, false);

    const read = await bookings.getHospitalityBooking({ organizationId: organizationA.id, actorUserId: staffA.id, bookingId: created.id });
    assert.equal(read.customerId, customer.id);
    await assert.rejects(bookings.getHospitalityBooking({ organizationId: organizationB.id, actorUserId: adminB.id, bookingId: created.id }), /not available/i);
    const listed = await bookings.listHospitalityBookings({ organizationId: organizationA.id, actorUserId: staffA.id, pageSize: 500 });
    assert.equal(listed.total, 1);
    assert.equal(listed.bookings[0]?.id, created.id);

    const events = await db.auditEvent.findMany({ where: { organizationId: organizationA.id, resourceType: 'hospitality-booking', resourceId: created.id } });
    assert.equal(events.filter((event) => event.action === 'booking.confirmed').length, 1);
  } finally {
    await db.auditEvent.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.hospitalityBookingAllocation.deleteMany({ where: { organizationId: organizationA.id } });
    await db.hospitalityBooking.deleteMany({ where: { organizationId: organizationA.id } });
    await db.hospitalityAvailabilityHold.deleteMany({ where: { organizationId: organizationA.id } });
    await db.hospitalityRoomTypeRatePlan.deleteMany({ where: { organizationId: organizationA.id } });
    await db.hospitalityRatePlan.deleteMany({ where: { organizationId: organizationA.id } });
    await db.hospitalityRoom.deleteMany({ where: { organizationId: organizationA.id } });
    await db.hospitalityRoomType.deleteMany({ where: { organizationId: organizationA.id } });
    await db.hospitalityProperty.deleteMany({ where: { organizationId: organizationA.id } });
    await db.customer.deleteMany({ where: { organizationId: organizationA.id } });
    await db.organizationMembership.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.organization.deleteMany({ where: { id: { in: [organizationA.id, organizationB.id] } } });
    await db.user.deleteMany({ where: { id: { in: [adminA.id, staffA.id, adminB.id] } } });
  }
});
