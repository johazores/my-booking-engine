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
  const adminA = await db.user.create({ data: { email: `reschedule-admin-a-${runId}@example.test`, status: 'ACTIVE' } });
  const staffA = await db.user.create({ data: { email: `reschedule-staff-a-${runId}@example.test`, status: 'ACTIVE' } });
  const adminB = await db.user.create({ data: { email: `reschedule-admin-b-${runId}@example.test`, status: 'ACTIVE' } });
  const organizationA = await db.organization.create({ data: { name: 'Reschedule Tenant A', slug: `reschedule-a-${runId}`.slice(0, 63), kind: 'HOTEL', currency: 'USD' } });
  const organizationB = await db.organization.create({ data: { name: 'Reschedule Tenant B', slug: `reschedule-b-${runId}`.slice(0, 63), kind: 'HOTEL', currency: 'USD' } });
  await db.organizationMembership.createMany({ data: [
    { organizationId: organizationA.id, userId: adminA.id, status: 'ACTIVE', role: 'ADMIN' },
    { organizationId: organizationA.id, userId: staffA.id, status: 'ACTIVE', role: 'STAFF' },
    { organizationId: organizationB.id, userId: adminB.id, status: 'ACTIVE', role: 'ADMIN' },
  ] });

  try {
    const customer = await db.customer.create({ data: { organizationId: organizationA.id, firstName: 'Reschedule', lastName: 'Guest', email: `reschedule-guest-${runId}@example.test` } });
    const property = await db.hospitalityProperty.create({ data: { organizationId: organizationA.id, name: 'Reschedule Hotel', code: 'RSC', timezone: 'UTC', countryCode: 'US' } });
    const roomType = await db.hospitalityRoomType.create({ data: { organizationId: organizationA.id, propertyId: property.id, name: 'Standard', code: 'STD', maxOccupancy: 2 } });
    await db.hospitalityRoom.create({ data: { organizationId: organizationA.id, propertyId: property.id, roomTypeId: roomType.id, code: '101' } });
    const ratePlan = await db.hospitalityRatePlan.create({ data: { organizationId: organizationA.id, propertyId: property.id, name: 'Flexible', code: 'FLEX' } });
    await db.hospitalityRoomTypeRatePlan.create({ data: { organizationId: organizationA.id, propertyId: property.id, roomTypeId: roomType.id, ratePlanId: ratePlan.id } });
    const baseRate = await pricing.createHospitalityBaseRate({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      baseRate: { propertyId: property.id, roomTypeId: roomType.id, ratePlanId: ratePlan.id, startDate: '2026-09-01', endDate: '2026-10-31', amount: '100.00' },
    });

    const now = new Date('2026-09-01T00:00:00.000Z');
    const originalRequest = { propertyId: property.id, roomTypeId: roomType.id, ratePlanId: ratePlan.id, arrivalDate: '2026-09-10', departureDate: '2026-09-12', quantity: 1 };
    const hold = await holds.createHospitalityAvailabilityHold({ organizationId: organizationA.id, actorUserId: adminA.id, now, hold: { idempotencyKey: 'hold:reschedule-main', request: originalRequest } });
    const quote = await pricing.quoteHospitalityPrice({ organizationId: organizationA.id, actorUserId: adminA.id, request: originalRequest });
    const booking = await bookings.confirmHospitalityBookingFromHold({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      now,
      confirmation: { holdId: hold.id, customerId: customer.id, idempotencyKey: 'booking:reschedule-main', expectedPricingFingerprint: quote.fingerprint, guests: [{ firstName: 'Reschedule', lastName: 'Guest' }] },
    });

    const firstChange = { arrivalDate: '2026-09-11', departureDate: '2026-09-13', idempotencyKey: 'reschedule:first-change' };
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
    assert.equal(rescheduled.arrivalDate.toISOString().slice(0, 10), '2026-09-11');
    assert.equal(rescheduled.departureDate.toISOString().slice(0, 10), '2026-09-13');
    assert.equal(rescheduled.totalMinor.toString(), booking.totalMinor.toString());
    assert.equal(rescheduled.paymentStatus, booking.paymentStatus);
    const allocation = await db.hospitalityBookingAllocation.findUniqueOrThrow({ where: { organizationId_bookingId: { organizationId: organizationA.id, bookingId: booking.id } } });
    assert.equal(allocation.arrivalDate.toISOString().slice(0, 10), '2026-09-11');
    assert.equal(allocation.departureDate.toISOString().slice(0, 10), '2026-09-13');

    const exactRetry = await reschedules.rescheduleHospitalityBooking({ organizationId: organizationA.id, actorUserId: adminA.id, bookingId: booking.id, change: firstChange, now });
    assert.equal(exactRetry.id, booking.id);
    assert.equal(await db.auditEvent.count({ where: { organizationId: organizationA.id, resourceType: 'hospitality-booking', resourceId: booking.id, action: 'booking.rescheduled' } }), 1);
    await assert.rejects(
      reschedules.rescheduleHospitalityBooking({ organizationId: organizationA.id, actorUserId: adminA.id, bookingId: booking.id, change: { ...firstChange, departureDate: '2026-09-14' }, now }),
      /idempotency key/i,
    );

    await db.hospitalityBaseRate.update({ where: { id: baseRate.id }, data: { amountMinor: 11_000n } });
    await assert.rejects(
      reschedules.rescheduleHospitalityBooking({ organizationId: organizationA.id, actorUserId: adminA.id, bookingId: booking.id, change: { arrivalDate: '2026-09-14', departureDate: '2026-09-16', idempotencyKey: 'reschedule:price-change' }, now }),
      /payment-adjustment workflow/i,
    );
    const afterRejectedPrice = await db.hospitalityBooking.findUniqueOrThrow({ where: { id: booking.id } });
    assert.equal(afterRejectedPrice.arrivalDate.toISOString().slice(0, 10), '2026-09-11');
    await db.hospitalityBaseRate.update({ where: { id: baseRate.id }, data: { amountMinor: 10_000n } });

    const blockingHoldRequest = { propertyId: property.id, roomTypeId: roomType.id, ratePlanId: ratePlan.id, arrivalDate: '2026-09-20', departureDate: '2026-09-22', quantity: 1 };
    await holds.createHospitalityAvailabilityHold({ organizationId: organizationA.id, actorUserId: adminA.id, now, hold: { idempotencyKey: 'hold:reschedule-block', request: blockingHoldRequest } });
    await assert.rejects(
      reschedules.rescheduleHospitalityBooking({ organizationId: organizationA.id, actorUserId: adminA.id, bookingId: booking.id, change: { arrivalDate: '2026-09-20', departureDate: '2026-09-22', idempotencyKey: 'reschedule:blocked-capacity' }, now }),
      /enough sellable inventory/i,
    );

    const secondChange = { arrivalDate: '2026-09-15', departureDate: '2026-09-17', idempotencyKey: 'reschedule:second-change' };
    await reschedules.rescheduleHospitalityBooking({ organizationId: organizationA.id, actorUserId: adminA.id, bookingId: booking.id, change: secondChange, now });
    await assert.rejects(
      reschedules.rescheduleHospitalityBooking({ organizationId: organizationA.id, actorUserId: adminA.id, bookingId: booking.id, change: firstChange, now }),
      /changed again afterward/i,
    );

    const events = await db.auditEvent.findMany({ where: { organizationId: organizationA.id, resourceType: 'hospitality-booking', resourceId: booking.id, action: 'booking.rescheduled' }, orderBy: { createdAt: 'asc' } });
    assert.equal(events.length, 2);
    assert.equal((events[0]?.beforeData as { arrivalDate?: string } | null)?.arrivalDate, '2026-09-10');
    assert.equal((events[0]?.afterData as { arrivalDate?: string } | null)?.arrivalDate, '2026-09-11');
    assert.equal(JSON.stringify(events).includes('reschedule-guest-'), false);
  } finally {
    await db.auditEvent.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.paymentCheckoutSession.deleteMany({ where: { organizationId: organizationA.id } });
    await db.paymentTransaction.deleteMany({ where: { organizationId: organizationA.id } });
    await db.hospitalityBookingGuest.deleteMany({ where: { organizationId: organizationA.id } });
    await db.hospitalityBookingAllocation.deleteMany({ where: { organizationId: organizationA.id } });
    await db.hospitalityBooking.deleteMany({ where: { organizationId: organizationA.id } });
    await db.hospitalityAvailabilityHold.deleteMany({ where: { organizationId: organizationA.id } });
    await db.hospitalityBaseRate.deleteMany({ where: { organizationId: organizationA.id } });
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
