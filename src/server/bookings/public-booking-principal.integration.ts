import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) throw new Error('Public booking principal integration tests must run through npm run test:database with TEST_DATABASE_URL.');

test('public booking principals, hold ownership, and audit attribution are tenant-safe', async () => {
  const [{ db }, holds] = await Promise.all([
    import('../database.ts'),
    import('../availability/hospitality-availability-hold-service.ts'),
  ]);
  const runId = crypto.randomUUID();
  const userIds = Array.from({ length: 2 }, () => crypto.randomUUID());
  const organizationIds = Array.from({ length: 2 }, () => crypto.randomUUID());
  try {
    const databaseClock = await db.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    const currentTime = databaseClock[0]?.now;
    assert.ok(currentTime instanceof Date, 'PostgreSQL clock is required for future booking fixtures');
    const dateAt = (days: number) => new Date(currentTime.getTime() + days * 86_400_000);
    const dateOnly = (days: number) => dateAt(days).toISOString().slice(0, 10);
    const adminA = await db.user.create({ data: { id: userIds[0], email: `public-principal-a-${runId}@example.test`, status: 'ACTIVE' } });
    const adminB = await db.user.create({ data: { id: userIds[1], email: `public-principal-b-${runId}@example.test`, status: 'ACTIVE' } });
    const organizationA = await db.organization.create({ data: { id: organizationIds[0], name: 'Public Principal Tenant A', slug: `public-principal-a-${runId}`.slice(0, 63), kind: 'HOTEL' } });
    const organizationB = await db.organization.create({ data: { id: organizationIds[1], name: 'Public Principal Tenant B', slug: `public-principal-b-${runId}`.slice(0, 63), kind: 'HOTEL' } });
    await db.organizationMembership.createMany({ data: [
      { organizationId: organizationA.id, userId: adminA.id, status: 'ACTIVE', role: 'ADMIN' },
      { organizationId: organizationB.id, userId: adminB.id, status: 'ACTIVE', role: 'ADMIN' },
    ] });
    const property = await db.hospitalityProperty.create({ data: { organizationId: organizationA.id, name: 'Public Principal Hotel', code: 'PPH', timezone: 'UTC', countryCode: 'US' } });
    const roomType = await db.hospitalityRoomType.create({ data: { organizationId: organizationA.id, propertyId: property.id, name: 'Room', code: 'ROOM', maxOccupancy: 2 } });
    await db.hospitalityRoom.create({ data: { organizationId: organizationA.id, propertyId: property.id, roomTypeId: roomType.id, code: '101' } });
    const ratePlan = await db.hospitalityRatePlan.create({ data: { organizationId: organizationA.id, propertyId: property.id, name: 'Flexible', code: 'FLEX' } });
    await db.hospitalityRoomTypeRatePlan.create({ data: { organizationId: organizationA.id, propertyId: property.id, roomTypeId: roomType.id, ratePlanId: ratePlan.id } });
    const now = currentTime;
    const hold = await holds.createHospitalityAvailabilityHold({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      now,
      hold: {
        idempotencyKey: `public-principal:${runId}`,
        request: {
          propertyId: property.id,
          roomTypeId: roomType.id,
          ratePlanId: ratePlan.id,
          arrivalDate: dateOnly(9),
          departureDate: dateOnly(10),
          quantity: 1,
        },
      },
    });

    const principal = await db.publicBookingPrincipal.create({
      data: { organizationId: organizationA.id, expiresAt: hold.expiresAt },
    });
    const ownership = await db.publicBookingHoldOwnership.create({
      data: { organizationId: organizationA.id, holdId: hold.id, principalId: principal.id },
    });
    assert.equal(ownership.principalId, principal.id);

    const audit = await db.publicBookingAuditEvent.create({
      data: {
        organizationId: organizationA.id,
        actorPrincipalId: principal.id,
        action: 'public-booking.hold.claimed',
        resourceType: 'hospitality-availability-hold',
        resourceId: hold.id,
        afterData: { expiresAt: hold.expiresAt.toISOString() },
      },
    });
    assert.equal(audit.actorPrincipalId, principal.id);

    await assert.rejects(
      db.publicBookingHoldOwnership.create({
        data: { organizationId: organizationB.id, holdId: hold.id, principalId: principal.id },
      }),
    );
    await assert.rejects(
      db.publicBookingAuditEvent.create({
        data: {
          organizationId: organizationB.id,
          actorPrincipalId: principal.id,
          action: 'public-booking.cross-tenant-denied',
          resourceType: 'hospitality-availability-hold',
          resourceId: hold.id,
        },
      }),
    );
  } finally {
    try {
      await db.publicBookingAuditEvent.deleteMany({ where: { organizationId: { in: [organizationIds[0], organizationIds[1]] } } });
      await db.publicBookingHoldOwnership.deleteMany({ where: { organizationId: { in: [organizationIds[0], organizationIds[1]] } } });
      await db.publicBookingPrincipal.deleteMany({ where: { organizationId: { in: [organizationIds[0], organizationIds[1]] } } });
      await db.auditEvent.deleteMany({ where: { organizationId: { in: [organizationIds[0], organizationIds[1]] } } });
      await db.hospitalityAvailabilityHold.deleteMany({ where: { organizationIds[0] } });
      await db.hospitalityRoomTypeRatePlan.deleteMany({ where: { organizationIds[0] } });
      await db.hospitalityRatePlan.deleteMany({ where: { organizationIds[0] } });
      await db.hospitalityRoom.deleteMany({ where: { organizationIds[0] } });
      await db.hospitalityRoomType.deleteMany({ where: { organizationIds[0] } });
      await db.hospitalityProperty.deleteMany({ where: { organizationIds[0] } });
      await db.organizationMembership.deleteMany({ where: { organizationId: { in: [organizationIds[0], organizationIds[1]] } } });
      await db.organization.deleteMany({ where: { id: { in: [organizationIds[0], organizationIds[1]] } } });
      await db.user.deleteMany({ where: { id: { in: [userIds[0], userIds[1]] } } });
    } finally {
      await db.$disconnect();
    }
  }
});