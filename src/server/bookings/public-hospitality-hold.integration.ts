import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) throw new Error('Public hospitality hold integration tests must run through npm run test:database with TEST_DATABASE_URL.');

const publicBookingSecret = 'public-booking-test-secret-0123456789abcdef';
process.env.SF_PUBLIC_BOOKING_SECRET = publicBookingSecret;

function dateOnlyDaysFromNow(days: number) {
  const value = new Date();
  value.setUTCHours(0, 0, 0, 0);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

test('public hospitality holds are tenant-bound, idempotent, owned, audited, and releasable', async () => {
  const [{ db }, publicHolds, capabilities] = await Promise.all([
    import('../database.ts'),
    import('./public-hospitality-hold-service.ts'),
    import('./public-booking-capability.ts'),
  ]);
  const runId = crypto.randomUUID();
  const organizationA = await db.organization.create({ data: { name: 'Public Hold Tenant A', slug: `public-hold-a-${runId}`.slice(0, 63), kind: 'HOTEL' } });
  const organizationB = await db.organization.create({ data: { name: 'Public Hold Tenant B', slug: `public-hold-b-${runId}`.slice(0, 63), kind: 'HOTEL' } });

  try {
    const property = await db.hospitalityProperty.create({ data: { organizationId: organizationA.id, name: 'Public Hold Hotel', code: 'PHH', timezone: 'UTC', countryCode: 'US' } });
    const roomType = await db.hospitalityRoomType.create({ data: { organizationId: organizationA.id, propertyId: property.id, name: 'Room', code: 'ROOM', maxOccupancy: 2 } });
    await db.hospitalityRoom.create({ data: { organizationId: organizationA.id, propertyId: property.id, roomTypeId: roomType.id, code: '101' } });
    const ratePlan = await db.hospitalityRatePlan.create({ data: { organizationId: organizationA.id, propertyId: property.id, name: 'Flexible', code: 'FLEX' } });
    await db.hospitalityRoomTypeRatePlan.create({ data: { organizationId: organizationA.id, propertyId: property.id, roomTypeId: roomType.id, ratePlanId: ratePlan.id } });

    const now = new Date();
    const requestKey = crypto.randomUUID();
    const request = {
      propertyId: property.id,
      roomTypeId: roomType.id,
      ratePlanId: ratePlan.id,
      arrivalDate: dateOnlyDaysFromNow(7),
      departureDate: dateOnlyDaysFromNow(8),
      quantity: 1,
    };

    const created = await publicHolds.createPublicHospitalityAvailabilityHold({
      organizationSlug: organizationA.slug,
      requestKey,
      request,
      now,
    });
    assert.equal(created.hold.status, 'ACTIVE');
    assert.equal(created.hold.quantity, 1);
    assert.equal('id' in created.hold, false);
    assert.equal(created.capability.includes(organizationA.id), false);

    const firstCapability = capabilities.verifyPublicBookingHoldCapability({
      secret: publicBookingSecret,
      token: created.capability,
      expectedOrganizationId: organizationA.id,
      now,
    });
    assert.ok(firstCapability);

    const ownership = await db.publicBookingHoldOwnership.findUnique({
      where: { organizationId_holdId: { organizationId: organizationA.id, holdId: firstCapability.holdId } },
    });
    assert.ok(ownership);
    assert.equal(ownership.principalId, firstCapability.principalId);
    assert.equal(await db.auditEvent.count({ where: { organizationId: organizationA.id, resourceId: firstCapability.holdId } }), 0);
    assert.equal(await db.publicBookingAuditEvent.count({ where: { organizationId: organizationA.id, resourceId: firstCapability.holdId, action: 'public-booking.hold.created' } }), 1);

    const retried = await publicHolds.createPublicHospitalityAvailabilityHold({
      organizationSlug: organizationA.slug,
      requestKey,
      request,
      now,
    });
    const retryCapability = capabilities.verifyPublicBookingHoldCapability({
      secret: publicBookingSecret,
      token: retried.capability,
      expectedOrganizationId: organizationA.id,
      now,
    });
    assert.ok(retryCapability);
    assert.equal(retryCapability.holdId, firstCapability.holdId);
    assert.equal(retryCapability.principalId, firstCapability.principalId);
    assert.equal(await db.hospitalityAvailabilityHold.count({ where: { organizationId: organizationA.id } }), 1);
    assert.equal(await db.publicBookingPrincipal.count({ where: { organizationId: organizationA.id } }), 1);
    assert.equal(await db.publicBookingAuditEvent.count({ where: { organizationId: organizationA.id, action: 'public-booking.hold.created' } }), 1);

    await assert.rejects(
      publicHolds.createPublicHospitalityAvailabilityHold({
        organizationSlug: organizationA.slug,
        requestKey,
        request: { ...request, quantity: 2 },
        now,
      }),
      { name: 'AvailabilityHoldConflictError' },
    );
    await assert.rejects(
      publicHolds.releasePublicHospitalityAvailabilityHold({
        organizationSlug: organizationB.slug,
        capability: created.capability,
        now,
      }),
      { name: 'PublicHospitalityHoldAuthorizationError' },
    );

    const released = await publicHolds.releasePublicHospitalityAvailabilityHold({
      organizationSlug: organizationA.slug,
      capability: created.capability,
      now,
    });
    assert.equal(released.hold.status, 'RELEASED');
    assert.equal(await db.publicBookingAuditEvent.count({ where: { organizationId: organizationA.id, resourceId: firstCapability.holdId, action: 'public-booking.hold.released' } }), 1);

    const releasedAgain = await publicHolds.releasePublicHospitalityAvailabilityHold({
      organizationSlug: organizationA.slug,
      capability: created.capability,
      now,
    });
    assert.equal(releasedAgain.hold.status, 'RELEASED');
    assert.equal(await db.publicBookingAuditEvent.count({ where: { organizationId: organizationA.id, resourceId: firstCapability.holdId, action: 'public-booking.hold.released' } }), 1);

    await assert.rejects(
      publicHolds.createPublicHospitalityAvailabilityHold({
        organizationSlug: organizationA.slug,
        requestKey,
        request,
        now,
      }),
      { name: 'AvailabilityHoldUnavailableError' },
    );
  } finally {
    await db.publicBookingAuditEvent.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.publicBookingHoldOwnership.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.publicBookingPrincipal.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.auditEvent.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.hospitalityAvailabilityHold.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.hospitalityRoomTypeRatePlan.deleteMany({ where: { organizationId: organizationA.id } });
    await db.hospitalityRatePlan.deleteMany({ where: { organizationId: organizationA.id } });
    await db.hospitalityRoom.deleteMany({ where: { organizationId: organizationA.id } });
    await db.hospitalityRoomType.deleteMany({ where: { organizationId: organizationA.id } });
    await db.hospitalityProperty.deleteMany({ where: { organizationId: organizationA.id } });
    await db.organization.deleteMany({ where: { id: { in: [organizationA.id, organizationB.id] } } });
  }
});
