import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) throw new Error('Public hospitality confirmation integration tests must run through npm run test:database with TEST_DATABASE_URL.');

const publicBookingSecret = 'public-booking-confirmation-test-secret-0123456789abcdef';
process.env.SF_PUBLIC_BOOKING_SECRET = publicBookingSecret;

function dateOnlyDaysFromNow(days: number) {
  const value = new Date();
  value.setUTCHours(0, 0, 0, 0);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

test('public confirmation creates one tenant-owned payment-pending booking with bounded allocation protection and exact retries', async () => {
  const [{ db }, publicHolds, publicQuotes, publicConfirmations, capabilities, pricing, availability] = await Promise.all([
    import('../database.ts'),
    import('./public-hospitality-hold-service.ts'),
    import('./public-hospitality-quote-service.ts'),
    import('./public-hospitality-confirmation-service.ts'),
    import('./public-booking-capability.ts'),
    import('../pricing/hospitality-pricing-service.ts'),
    import('../availability/hospitality-availability-service.ts'),
  ]);
  const runId = crypto.randomUUID();
  const admin = await db.user.create({ data: { email: `public-confirm-admin-${runId}@example.test`, status: 'ACTIVE' } });
  const organizationA = await db.organization.create({ data: { name: 'Public Confirmation Tenant A', slug: `public-confirm-a-${runId}`.slice(0, 63), kind: 'HOTEL', currency: 'USD' } });
  const organizationB = await db.organization.create({ data: { name: 'Public Confirmation Tenant B', slug: `public-confirm-b-${runId}`.slice(0, 63), kind: 'HOTEL', currency: 'USD' } });
  await db.organizationMembership.create({ data: { organizationId: organizationA.id, userId: admin.id, status: 'ACTIVE', role: 'ADMIN' } });

  try {
    const property = await db.hospitalityProperty.create({ data: { organizationId: organizationA.id, name: 'Public Confirmation Hotel', code: 'PCH', timezone: 'UTC', countryCode: 'US' } });
    const roomType = await db.hospitalityRoomType.create({ data: { organizationId: organizationA.id, propertyId: property.id, name: 'Room', code: 'ROOM', maxOccupancy: 2 } });
    await db.hospitalityRoom.create({ data: { organizationId: organizationA.id, propertyId: property.id, roomTypeId: roomType.id, code: '101' } });
    const ratePlan = await db.hospitalityRatePlan.create({ data: { organizationId: organizationA.id, propertyId: property.id, name: 'Flexible', code: 'FLEX' } });
    await db.hospitalityRoomTypeRatePlan.create({ data: { organizationId: organizationA.id, propertyId: property.id, roomTypeId: roomType.id, ratePlanId: ratePlan.id } });
    await pricing.createHospitalityBaseRate({
      organizationId: organizationA.id,
      actorUserId: admin.id,
      baseRate: {
        propertyId: property.id,
        roomTypeId: roomType.id,
        ratePlanId: ratePlan.id,
        startDate: dateOnlyDaysFromNow(1),
        endDate: dateOnlyDaysFromNow(30),
        amount: '125.00',
      },
    });

    const now = new Date();
    const arrivalDate = dateOnlyDaysFromNow(7);
    const departureDate = dateOnlyDaysFromNow(9);
    const hold = await publicHolds.createPublicHospitalityAvailabilityHold({
      organizationSlug: organizationA.slug,
      requestKey: crypto.randomUUID(),
      request: {
        propertyId: property.id,
        roomTypeId: roomType.id,
        ratePlanId: ratePlan.id,
        arrivalDate,
        departureDate,
        quantity: 1,
      },
      now,
    });
    const quote = await publicQuotes.quotePublicHospitalityHold({ organizationSlug: organizationA.slug, capability: hold.capability, now });
    const requestKey = crypto.randomUUID();
    const request = {
      organizationSlug: organizationA.slug,
      capability: hold.capability,
      requestKey,
      expectedPricingFingerprint: quote.pricingFingerprint,
      customer: { firstName: 'Ada', lastName: 'Lovelace', email: `PUBLIC-${runId}@EXAMPLE.TEST`, phone: '+1 555 0100' },
      guests: [{ firstName: 'Ada', lastName: 'Lovelace', email: `public-${runId}@example.test` }],
      now,
    };

    const created = await publicConfirmations.confirmPublicHospitalityBookingFromHold(request);
    assert.equal(created.booking.status, 'PENDING_CONFIRMATION');
    assert.equal(created.booking.paymentStatus, 'UNPAID');
    assert.equal(created.booking.totalMinor, '25000');
    assert.equal('id' in created.booking, false);
    assert.equal(created.bookingCapability.includes(organizationA.id), false);
    const paymentStartDeadlineAt = new Date(created.paymentStartDeadlineAt);
    assert.ok(paymentStartDeadlineAt > now);

    const bookingCapability = capabilities.verifyPublicBookingBookingCapability({
      secret: publicBookingSecret,
      token: created.bookingCapability,
      expectedOrganizationId: organizationA.id,
      now,
    });
    assert.ok(bookingCapability);
    const ownership = await db.publicBookingBookingOwnership.findUnique({
      where: { organizationId_bookingId: { organizationId: organizationA.id, bookingId: bookingCapability.bookingId } },
    });
    assert.ok(ownership);
    assert.equal(ownership.principalId, bookingCapability.principalId);
    assert.equal(await db.hospitalityBooking.count({ where: { organizationId: organizationA.id } }), 1);
    assert.equal(await db.customer.count({ where: { organizationId: organizationA.id } }), 1);
    assert.equal(await db.auditEvent.count({ where: { organizationId: organizationA.id, resourceId: bookingCapability.bookingId, action: 'booking.confirmed' } }), 0);
    assert.equal(await db.publicBookingAuditEvent.count({ where: { organizationId: organizationA.id, resourceId: bookingCapability.bookingId, action: 'public-booking.payment-pending' } }), 1);
    assert.equal(await db.publicBookingAuditEvent.count({ where: { organizationId: organizationA.id, resourceId: bookingCapability.bookingId, action: 'public-booking.confirmed' } }), 0);

    const protectedAvailability = await availability.readHospitalityAvailabilityForOrganization({
      organizationId: organizationA.id,
      request: { propertyId: property.id, roomTypeId: roomType.id, ratePlanId: ratePlan.id, arrivalDate, departureDate, quantity: 1 },
      now: new Date(paymentStartDeadlineAt.getTime() - 1),
    });
    assert.equal(protectedAvailability.available, false);
    assert.equal(protectedAvailability.capacity.bookingAllocationCount, 1);

    const releasedAvailability = await availability.readHospitalityAvailabilityForOrganization({
      organizationId: organizationA.id,
      request: { propertyId: property.id, roomTypeId: roomType.id, ratePlanId: ratePlan.id, arrivalDate, departureDate, quantity: 1 },
      now: paymentStartDeadlineAt,
    });
    assert.equal(releasedAvailability.available, true);
    assert.equal(releasedAvailability.capacity.bookingAllocationCount, 0);

    const retried = await publicConfirmations.confirmPublicHospitalityBookingFromHold(request);
    const retryCapability = capabilities.verifyPublicBookingBookingCapability({ secret: publicBookingSecret, token: retried.bookingCapability, expectedOrganizationId: organizationA.id, now });
    assert.ok(retryCapability);
    assert.equal(retryCapability.bookingId, bookingCapability.bookingId);
    assert.equal(retried.paymentStartDeadlineAt, created.paymentStartDeadlineAt);
    assert.equal(await db.hospitalityBooking.count({ where: { organizationId: organizationA.id } }), 1);
    assert.equal(await db.customer.count({ where: { organizationId: organizationA.id } }), 1);
    assert.equal(await db.publicBookingAuditEvent.count({ where: { organizationId: organizationA.id, resourceId: bookingCapability.bookingId, action: 'public-booking.payment-pending' } }), 1);

    await assert.rejects(
      publicConfirmations.confirmPublicHospitalityBookingFromHold({ ...request, customer: { ...request.customer, firstName: 'Changed' } }),
      { name: 'PublicHospitalityConfirmationConflictError' },
    );
    await assert.rejects(
      publicConfirmations.confirmPublicHospitalityBookingFromHold({ ...request, organizationSlug: organizationB.slug }),
      { name: 'PublicHospitalityHoldAuthorizationError' },
    );
  } finally {
    await db.publicBookingAuditEvent.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.publicBookingBookingOwnership.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.publicBookingHoldOwnership.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.publicBookingPrincipal.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.auditEvent.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
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
    await db.organizationMembership.deleteMany({ where: { organizationId: organizationA.id } });
    await db.organization.deleteMany({ where: { id: { in: [organizationA.id, organizationB.id] } } });
    await db.user.delete({ where: { id: admin.id } });
  }
});
