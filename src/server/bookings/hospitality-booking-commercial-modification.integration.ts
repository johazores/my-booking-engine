import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) {
  throw new Error('Hospitality commercial modification integration tests must run through npm run test:database with TEST_DATABASE_URL.');
}

test('commercial booking modification is tenant-safe, capacity-safe, price-safe, and idempotent', async () => {
  const [{ db }, holds, bookings, modifications, pricing] = await Promise.all([
    import('../database.ts'),
    import('../availability/hospitality-availability-hold-service.ts'),
    import('./hospitality-booking-service.ts'),
    import('./hospitality-booking-commercial-modification-service.ts'),
    import('../pricing/hospitality-pricing-service.ts'),
  ]);
  const runId = crypto.randomUUID();
  const adminA = await db.user.create({ data: { email: `commercial-admin-a-${runId}@example.test`, status: 'ACTIVE' } });
  const staffA = await db.user.create({ data: { email: `commercial-staff-a-${runId}@example.test`, status: 'ACTIVE' } });
  const adminB = await db.user.create({ data: { email: `commercial-admin-b-${runId}@example.test`, status: 'ACTIVE' } });
  const organizationA = await db.organization.create({ data: { name: 'Commercial Tenant A', slug: `commercial-a-${runId}`.slice(0, 63), kind: 'HOTEL', currency: 'USD' } });
  const organizationB = await db.organization.create({ data: { name: 'Commercial Tenant B', slug: `commercial-b-${runId}`.slice(0, 63), kind: 'HOTEL', currency: 'USD' } });
  await db.organizationMembership.createMany({ data: [
    { organizationId: organizationA.id, userId: adminA.id, status: 'ACTIVE', role: 'ADMIN' },
    { organizationId: organizationA.id, userId: staffA.id, status: 'ACTIVE', role: 'STAFF' },
    { organizationId: organizationB.id, userId: adminB.id, status: 'ACTIVE', role: 'ADMIN' },
  ] });

  try {
    const customer = await db.customer.create({ data: { organizationId: organizationA.id, firstName: 'Commercial', lastName: 'Guest', email: `commercial-guest-${runId}@example.test` } });
    const property = await db.hospitalityProperty.create({ data: { organizationId: organizationA.id, name: 'Commercial Hotel', code: 'COM', timezone: 'UTC', countryCode: 'US' } });
    const standard = await db.hospitalityRoomType.create({ data: { organizationId: organizationA.id, propertyId: property.id, name: 'Standard', code: 'STD', maxOccupancy: 2 } });
    const twin = await db.hospitalityRoomType.create({ data: { organizationId: organizationA.id, propertyId: property.id, name: 'Twin', code: 'TWN', maxOccupancy: 1 } });
    await db.hospitalityRoom.createMany({ data: [
      { organizationId: organizationA.id, propertyId: property.id, roomTypeId: standard.id, code: '101' },
      { organizationId: organizationA.id, propertyId: property.id, roomTypeId: twin.id, code: '201' },
      { organizationId: organizationA.id, propertyId: property.id, roomTypeId: twin.id, code: '202' },
    ] });
    const flexible = await db.hospitalityRatePlan.create({ data: { organizationId: organizationA.id, propertyId: property.id, name: 'Flexible', code: 'FLEX' } });
    const twinRate = await db.hospitalityRatePlan.create({ data: { organizationId: organizationA.id, propertyId: property.id, name: 'Twin Flexible', code: 'TWFLEX' } });
    await db.hospitalityRoomTypeRatePlan.createMany({ data: [
      { organizationId: organizationA.id, propertyId: property.id, roomTypeId: standard.id, ratePlanId: flexible.id },
      { organizationId: organizationA.id, propertyId: property.id, roomTypeId: twin.id, ratePlanId: twinRate.id },
    ] });
    const standardRate = await pricing.createHospitalityBaseRate({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      baseRate: { propertyId: property.id, roomTypeId: standard.id, ratePlanId: flexible.id, startDate: '2026-09-01', endDate: '2026-10-31', amount: '100.00' },
    });
    const targetRate = await pricing.createHospitalityBaseRate({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      baseRate: { propertyId: property.id, roomTypeId: twin.id, ratePlanId: twinRate.id, startDate: '2026-09-01', endDate: '2026-10-31', amount: '50.00' },
    });
    const standardAddon = await db.hospitalityAddon.create({ data: {
      organizationId: organizationA.id, propertyId: property.id, roomTypeId: standard.id, ratePlanId: flexible.id,
      name: 'Breakfast', code: 'BREAKFAST_STD', pricingModel: 'PER_BOOKING', amountMinor: 1_000n, currency: 'USD', maxQuantity: 1,
      startDate: new Date('2026-09-01T00:00:00.000Z'), endDate: new Date('2026-10-31T00:00:00.000Z'),
    } });
    const twinAddon = await db.hospitalityAddon.create({ data: {
      organizationId: organizationA.id, propertyId: property.id, roomTypeId: twin.id, ratePlanId: twinRate.id,
      name: 'Breakfast', code: 'BREAKFAST_TWIN', pricingModel: 'PER_BOOKING', amountMinor: 1_000n, currency: 'USD', maxQuantity: 1,
      startDate: new Date('2026-09-01T00:00:00.000Z'), endDate: new Date('2026-10-31T00:00:00.000Z'),
    } });

    const now = new Date('2026-09-01T00:00:00.000Z');
    const originalRequest = { propertyId: property.id, roomTypeId: standard.id, ratePlanId: flexible.id, arrivalDate: '2026-09-10', departureDate: '2026-09-12', quantity: 1 };
    const originalAddons = [{ addonId: standardAddon.id, quantity: 1 }];
    const hold = await holds.createHospitalityAvailabilityHold({ organizationId: organizationA.id, actorUserId: adminA.id, now, hold: { idempotencyKey: 'hold:commercial-main', request: originalRequest } });
    const quote = await pricing.quoteHospitalityPrice({ organizationId: organizationA.id, actorUserId: adminA.id, request: originalRequest, addonSelections: originalAddons });
    const booking = await bookings.confirmHospitalityBookingFromHold({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      now,
      confirmation: { holdId: hold.id, customerId: customer.id, idempotencyKey: 'booking:commercial-main', expectedPricingFingerprint: quote.fingerprint, addonSelections: originalAddons, guests: [{ firstName: 'Commercial', lastName: 'Guest' }] },
    });

    const firstChange = { roomTypeId: twin.id, ratePlanId: twinRate.id, quantity: 2, addonSelections: [{ addonId: twinAddon.id, quantity: 1 }], idempotencyKey: 'commercial:first-change' };
    await assert.rejects(modifications.modifyHospitalityBookingCommercialTerms({ organizationId: organizationA.id, actorUserId: staffA.id, bookingId: booking.id, change: firstChange, now }), /permission/i);
    await assert.rejects(modifications.modifyHospitalityBookingCommercialTerms({ organizationId: organizationB.id, actorUserId: adminB.id, bookingId: booking.id, change: firstChange, now }), /not available/i);

    const options = await modifications.getHospitalityBookingCommercialModificationOptions({ organizationId: organizationA.id, actorUserId: adminA.id, bookingId: booking.id });
    assert.equal(options.assignments.length, 2);
    assert.equal(options.addons.length, 2);

    const pendingPayment = await db.paymentTransaction.create({ data: {
      organizationId: organizationA.id, bookingId: booking.id, idempotencyKey: 'commercial:pending-payment', kind: 'CAPTURE', status: 'PENDING', providerCode: 'TEST', providerReference: `pending-${runId}`, currency: 'USD', amountMinor: booking.totalMinor,
    } });
    await assert.rejects(modifications.modifyHospitalityBookingCommercialTerms({ organizationId: organizationA.id, actorUserId: adminA.id, bookingId: booking.id, change: firstChange, now }), /unresolved payment operation/i);
    await db.paymentTransaction.delete({ where: { id: pendingPayment.id } });

    const modified = await modifications.modifyHospitalityBookingCommercialTerms({ organizationId: organizationA.id, actorUserId: adminA.id, bookingId: booking.id, change: firstChange, now });
    assert.equal(modified.roomTypeId, twin.id);
    assert.equal(modified.ratePlanId, twinRate.id);
    assert.equal(modified.quantity, 2);
    assert.equal(modified.totalMinor.toString(), booking.totalMinor.toString());
    assert.equal(modified.accommodationSubtotalMinor.toString(), booking.accommodationSubtotalMinor.toString());
    assert.equal(modified.addonTotalMinor.toString(), booking.addonTotalMinor.toString());
    assert.notEqual(modified.pricingFingerprint, booking.pricingFingerprint);
    const allocation = await db.hospitalityBookingAllocation.findUniqueOrThrow({ where: { organizationId_bookingId: { organizationId: organizationA.id, bookingId: booking.id } } });
    assert.equal(allocation.roomTypeId, twin.id);
    assert.equal(allocation.quantity, 2);

    const exactRetry = await modifications.modifyHospitalityBookingCommercialTerms({ organizationId: organizationA.id, actorUserId: adminA.id, bookingId: booking.id, change: firstChange, now });
    assert.equal(exactRetry.id, booking.id);
    assert.equal(await db.auditEvent.count({ where: { organizationId: organizationA.id, resourceType: 'hospitality-booking', resourceId: booking.id, action: 'booking.commercial-modified' } }), 1);
    await assert.rejects(modifications.modifyHospitalityBookingCommercialTerms({ organizationId: organizationA.id, actorUserId: adminA.id, bookingId: booking.id, change: { ...firstChange, quantity: 1 }, now }), /idempotency key/i);

    await db.hospitalityBaseRate.update({ where: { id: targetRate.id }, data: { amountMinor: 5_500n } });
    await assert.rejects(modifications.modifyHospitalityBookingCommercialTerms({ organizationId: organizationA.id, actorUserId: adminA.id, bookingId: booking.id, change: { ...firstChange, quantity: 1, idempotencyKey: 'commercial:price-change' }, now }), /payment-adjustment workflow/i);
    const afterRejectedPrice = await db.hospitalityBooking.findUniqueOrThrow({ where: { id: booking.id } });
    assert.equal(afterRejectedPrice.quantity, 2);
    await db.hospitalityBaseRate.update({ where: { id: targetRate.id }, data: { amountMinor: 5_000n } });

    const blockingHold = await holds.createHospitalityAvailabilityHold({ organizationId: organizationA.id, actorUserId: adminA.id, now, hold: { idempotencyKey: 'hold:commercial-block', request: originalRequest } });
    await assert.rejects(modifications.modifyHospitalityBookingCommercialTerms({
      organizationId: organizationA.id, actorUserId: adminA.id, bookingId: booking.id,
      change: { roomTypeId: standard.id, ratePlanId: flexible.id, quantity: 1, addonSelections: originalAddons, idempotencyKey: 'commercial:blocked-capacity' }, now,
    }), /enough sellable inventory/i);
    await db.hospitalityAvailabilityHold.update({ where: { id: blockingHold.id }, data: { status: 'RELEASED', endedAt: now } });

    const secondChange = { roomTypeId: standard.id, ratePlanId: flexible.id, quantity: 1, addonSelections: originalAddons, idempotencyKey: 'commercial:second-change' };
    await modifications.modifyHospitalityBookingCommercialTerms({ organizationId: organizationA.id, actorUserId: adminA.id, bookingId: booking.id, change: secondChange, now });
    await assert.rejects(modifications.modifyHospitalityBookingCommercialTerms({ organizationId: organizationA.id, actorUserId: adminA.id, bookingId: booking.id, change: firstChange, now }), /changed again afterward/i);

    const events = await db.auditEvent.findMany({ where: { organizationId: organizationA.id, resourceType: 'hospitality-booking', resourceId: booking.id, action: 'booking.commercial-modified' }, orderBy: { createdAt: 'asc' } });
    assert.equal(events.length, 2);
    assert.equal((events[0]?.beforeData as { roomTypeId?: string } | null)?.roomTypeId, standard.id);
    assert.equal((events[0]?.afterData as { roomTypeId?: string } | null)?.roomTypeId, twin.id);
    assert.equal(JSON.stringify(events).includes('commercial-guest-'), false);
    assert.ok(standardRate.id);
  } finally {
    await db.auditEvent.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.paymentCheckoutSession.deleteMany({ where: { organizationId: organizationA.id } });
    await db.paymentTransaction.deleteMany({ where: { organizationId: organizationA.id } });
    await db.hospitalityBookingGuest.deleteMany({ where: { organizationId: organizationA.id } });
    await db.hospitalityBookingAllocation.deleteMany({ where: { organizationId: organizationA.id } });
    await db.hospitalityBooking.deleteMany({ where: { organizationId: organizationA.id } });
    await db.hospitalityAvailabilityHold.deleteMany({ where: { organizationId: organizationA.id } });
    await db.hospitalityAddon.deleteMany({ where: { organizationId: organizationA.id } });
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
