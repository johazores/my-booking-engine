import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) throw new Error('Availability hold integration tests must run through npm run test:database with TEST_DATABASE_URL.');

test('hospitality holds are tenant-safe, idempotent, expiry-aware, and serialize last-unit allocation', async (t) => {
  const [{ db }, holds, availability, windows, ratePlans, inventory] = await Promise.all([
    import('../database.ts'),
    import('./hospitality-availability-hold-service.ts'),
    import('./hospitality-availability-service.ts'),
    import('./hospitality-availability-window-service.ts'),
    import('../inventory/hospitality-rate-plan-service.ts'),
    import('../inventory/hospitality-service.ts'),
  ]);
  const runId = crypto.randomUUID();
  const adminAId = crypto.randomUUID();
  const staffAId = crypto.randomUUID();
  const adminBId = crypto.randomUUID();
  const organizationAId = crypto.randomUUID();
  const organizationBId = crypto.randomUUID();
  let fixturesCleaned = false;
  async function cleanupFixtures() {
    if (fixturesCleaned) return;
    await db.auditEvent.deleteMany({ where: { organizationId: { in: [organizationAId, organizationBId] } } });
    await db.hospitalityAvailabilityHold.deleteMany({ where: { organizationId: organizationAId } });
    await db.hospitalityAvailabilityWindow.deleteMany({ where: { organizationId: organizationAId } });
    await db.hospitalityRoomTypeRatePlan.deleteMany({ where: { organizationId: organizationAId } });
    await db.hospitalityRatePlan.deleteMany({ where: { organizationId: organizationAId } });
    await db.hospitalityRoom.deleteMany({ where: { organizationId: organizationAId } });
    await db.hospitalityRoomType.deleteMany({ where: { organizationId: organizationAId } });
    await db.hospitalityProperty.deleteMany({ where: { organizationId: organizationAId } });
    await db.organizationMembership.deleteMany({ where: { organizationId: { in: [organizationAId, organizationBId] } } });
    await db.organization.deleteMany({ where: { id: { in: [organizationAId, organizationBId] } } });
    await db.user.deleteMany({ where: { id: { in: [adminAId, staffAId, adminBId] } } });
    fixturesCleaned = true;
  }
  t.after(async () => {
    try {
      await cleanupFixtures();
    } finally {
      await db.$disconnect();
    }
  });
  const adminA = await db.user.create({ data: { id: adminAId, email: `hold-admin-a-${runId}@example.test`, status: 'ACTIVE' } });
  const staffA = await db.user.create({ data: { id: staffAId, email: `hold-staff-a-${runId}@example.test`, status: 'ACTIVE' } });
  const adminB = await db.user.create({ data: { id: adminBId, email: `hold-admin-b-${runId}@example.test`, status: 'ACTIVE' } });
  const organizationA = await db.organization.create({ data: { id: organizationAId, name: 'Hold Tenant A', slug: `hold-a-${runId}`.slice(0, 63), kind: 'HOTEL' } });
  const organizationB = await db.organization.create({ data: { id: organizationBId, name: 'Hold Tenant B', slug: `hold-b-${runId}`.slice(0, 63), kind: 'HOTEL' } });
  await db.organizationMembership.createMany({ data: [
    { organizationId: organizationA.id, userId: adminA.id, status: 'ACTIVE', role: 'ADMIN' },
    { organizationId: organizationA.id, userId: staffA.id, status: 'ACTIVE', role: 'STAFF' },
    { organizationId: organizationB.id, userId: adminB.id, status: 'ACTIVE', role: 'ADMIN' },
  ] });

  try {
    const property = await db.hospitalityProperty.create({ data: { organizationId: organizationA.id, name: 'Hold Hotel', code: 'HOLD', timezone: 'UTC', countryCode: 'US' } });
    const roomType = await db.hospitalityRoomType.create({ data: { organizationId: organizationA.id, propertyId: property.id, name: 'Only Room', code: 'ONLY', maxOccupancy: 2 } });
    const room = await db.hospitalityRoom.create({ data: { organizationId: organizationA.id, propertyId: property.id, roomTypeId: roomType.id, code: '101' } });
    const ratePlan = await db.hospitalityRatePlan.create({ data: { organizationId: organizationA.id, propertyId: property.id, name: 'Flexible', code: 'FLEX' } });
    await db.hospitalityRoomTypeRatePlan.create({ data: { organizationId: organizationA.id, propertyId: property.id, roomTypeId: roomType.id, ratePlanId: ratePlan.id } });
    const [{ now }] = await db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    const dateAt = (days: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 30 + days)).toISOString().slice(0, 10);
    const request = { propertyId: property.id, roomTypeId: roomType.id, ratePlanId: ratePlan.id, arrivalDate: dateAt(0), departureDate: dateAt(2), quantity: 1 };

    await assert.rejects(
      holds.createHospitalityAvailabilityHold({ organizationId: organizationA.id, actorUserId: staffA.id, now, hold: { idempotencyKey: 'hold:staff-denied', request } }),
      /permission/i,
    );

    const attempts = await Promise.allSettled([
      holds.createHospitalityAvailabilityHold({ organizationId: organizationA.id, actorUserId: adminA.id, now, hold: { idempotencyKey: 'hold:last-unit-a', request } }),
      holds.createHospitalityAvailabilityHold({ organizationId: organizationA.id, actorUserId: adminA.id, now, hold: { idempotencyKey: 'hold:last-unit-b', request } }),
    ]);
    assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(attempts.filter((result) => result.status === 'rejected').length, 1);
    const fulfilled = attempts.find((result) => result.status === 'fulfilled');
    assert.ok(fulfilled && fulfilled.status === 'fulfilled');
    const created = fulfilled.value;

    const retry = await holds.createHospitalityAvailabilityHold({ organizationId: organizationA.id, actorUserId: adminA.id, now, hold: { idempotencyKey: created.idempotencyKey, request } });
    assert.equal(retry.id, created.id);
    await assert.rejects(
      holds.createHospitalityAvailabilityHold({ organizationId: organizationA.id, actorUserId: adminA.id, now, hold: { idempotencyKey: created.idempotencyKey, request: { ...request, quantity: 2 } } }),
      /different availability hold request/i,
    );

    const heldAvailability = await availability.readHospitalityAvailability({ organizationId: organizationA.id, actorUserId: staffA.id, now, request });
    assert.equal(heldAvailability.capacity.sellableUnits, 0);
    assert.equal(heldAvailability.capacity.activeHoldCount, 1);
    assert.equal(heldAvailability.available, false);

    await assert.rejects(
      windows.createHospitalityAvailabilityWindow({ organizationId: organizationA.id, actorUserId: adminA.id, now, window: { propertyId: property.id, roomTypeId: roomType.id, startDate: dateAt(0), endDate: dateAt(1), capacityLimit: 0 } }),
      /protected by active holds/i,
    );
    await assert.rejects(
      ratePlans.removeHospitalityRatePlanFromRoomType({ organizationId: organizationA.id, actorUserId: adminA.id, propertyId: property.id, roomTypeId: roomType.id, ratePlanId: ratePlan.id }),
      /active availability holds/i,
    );
    await assert.rejects(
      inventory.archiveHospitalityRoom({ organizationId: organizationA.id, actorUserId: adminA.id, roomId: room.id, confirmation: 'ARCHIVE' }),
      /active availability holds/i,
    );

    await assert.rejects(holds.releaseHospitalityAvailabilityHold({ organizationId: organizationB.id, actorUserId: adminB.id, holdId: created.id, now }), /not available/i);
    await holds.releaseHospitalityAvailabilityHold({ organizationId: organizationA.id, actorUserId: adminA.id, holdId: created.id, now });
    const restored = await availability.readHospitalityAvailability({ organizationId: organizationA.id, actorUserId: staffA.id, now, request });
    assert.equal(restored.capacity.sellableUnits, 1);

    const expiring = await holds.createHospitalityAvailabilityHold({ organizationId: organizationA.id, actorUserId: adminA.id, now, hold: { idempotencyKey: 'hold:expiry-check', expiresInMinutes: 1, request } });
    const afterExpiry = new Date(now.getTime() + 61_000);
    const expiryRead = await availability.readHospitalityAvailability({ organizationId: organizationA.id, actorUserId: staffA.id, now: afterExpiry, request });
    assert.equal(expiryRead.capacity.sellableUnits, 1);
    assert.equal(expiryRead.capacity.activeHoldCount, 0);
    assert.equal(await holds.expireHospitalityAvailabilityHolds({ organizationId: organizationA.id, actorUserId: adminA.id, now: afterExpiry }), 1);
    const expired = await db.hospitalityAvailabilityHold.findUniqueOrThrow({ where: { id: expiring.id } });
    assert.equal(expired.status, 'EXPIRED');

    const events = await db.auditEvent.findMany({ where: { organizationId: organizationA.id, resourceType: 'hospitality-availability-hold' } });
    assert.ok(events.some((event) => event.action === 'availability.hold.created'));
    assert.ok(events.some((event) => event.action === 'availability.hold.released'));
    assert.ok(events.some((event) => event.action === 'availability.hold.expired'));
  } finally {
    await cleanupFixtures();
  }
});
