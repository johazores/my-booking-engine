import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) throw new Error('Availability integration tests must run through npm run test:database with TEST_DATABASE_URL.');

test('hospitality availability enforces tenant scope, physical/window capacity, permissions, and effective restrictions', async (t) => {
  const [{ db }, availability, windows] = await Promise.all([
    import('../database.ts'),
    import('./hospitality-availability-service.ts'),
    import('./hospitality-availability-window-service.ts'),
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
    await db.hospitalityAvailabilityWindow.deleteMany({ where: { organizationId: { in: [organizationAId, organizationBId] } } });
    await db.hospitalityRestriction.deleteMany({ where: { organizationId: organizationAId } });
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
  const adminA = await db.user.create({ data: { id: adminAId, email: `availability-admin-a-${runId}@example.test`, status: 'ACTIVE' } });
  const staffA = await db.user.create({ data: { id: staffAId, email: `availability-staff-a-${runId}@example.test`, status: 'ACTIVE' } });
  const adminB = await db.user.create({ data: { id: adminBId, email: `availability-admin-b-${runId}@example.test`, status: 'ACTIVE' } });
  const organizationA = await db.organization.create({ data: { id: organizationAId, name: 'Availability Tenant A', slug: `availability-a-${runId}`.slice(0, 63), kind: 'HOTEL' } });
  const organizationB = await db.organization.create({ data: { id: organizationBId, name: 'Availability Tenant B', slug: `availability-b-${runId}`.slice(0, 63), kind: 'HOTEL' } });
  await db.organizationMembership.createMany({ data: [
    { organizationId: organizationA.id, userId: adminA.id, status: 'ACTIVE', role: 'ADMIN' },
    { organizationId: organizationA.id, userId: staffA.id, status: 'ACTIVE', role: 'STAFF' },
    { organizationId: organizationB.id, userId: adminB.id, status: 'ACTIVE', role: 'ADMIN' },
  ] });

  try {
    const [{ now }] = await db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    const dateAt = (days: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 30 + days)).toISOString().slice(0, 10);
    const propertyA = await db.hospitalityProperty.create({ data: { organizationId: organizationA.id, name: 'A Hotel', code: 'AVA', timezone: 'UTC', countryCode: 'US' } });
    const roomTypeA = await db.hospitalityRoomType.create({ data: { organizationId: organizationA.id, propertyId: propertyA.id, name: 'King', code: 'KING', maxOccupancy: 2 } });
    await db.hospitalityRoom.createMany({ data: [
      { organizationId: organizationA.id, propertyId: propertyA.id, roomTypeId: roomTypeA.id, code: '101' },
      { organizationId: organizationA.id, propertyId: propertyA.id, roomTypeId: roomTypeA.id, code: '102' },
      { organizationId: organizationA.id, propertyId: propertyA.id, roomTypeId: roomTypeA.id, code: '103', status: 'OUT_OF_SERVICE' },
    ] });
    const ratePlanA = await db.hospitalityRatePlan.create({ data: { organizationId: organizationA.id, propertyId: propertyA.id, name: 'Flexible', code: 'FLEX' } });
    await db.hospitalityRoomTypeRatePlan.create({ data: { organizationId: organizationA.id, propertyId: propertyA.id, roomTypeId: roomTypeA.id, ratePlanId: ratePlanA.id } });
    await db.hospitalityRestriction.create({ data: { organizationId: organizationA.id, propertyId: propertyA.id, roomTypeId: roomTypeA.id, ratePlanId: ratePlanA.id, startDate: new Date(`${dateAt(0)}T00:00:00.000Z`), endDate: new Date(`${dateAt(10)}T00:00:00.000Z`), minStayNights: 3 } });

    const available = await availability.readHospitalityAvailability({ organizationId: organizationA.id, actorUserId: staffA.id, request: { propertyId: propertyA.id, roomTypeId: roomTypeA.id, ratePlanId: ratePlanA.id, arrivalDate: dateAt(1), departureDate: dateAt(4), quantity: 2 } });
    assert.equal(available.capacity.physicalUnits, 2);
    assert.equal(available.capacity.sellableUnits, 2);
    assert.equal(available.available, true);

    await assert.rejects(
      windows.createHospitalityAvailabilityWindow({ organizationId: organizationA.id, actorUserId: staffA.id, window: { propertyId: propertyA.id, roomTypeId: roomTypeA.id, startDate: dateAt(1), endDate: dateAt(3), capacityLimit: 1 } }),
      /permission/i,
    );
    const capacityWindow = await windows.createHospitalityAvailabilityWindow({ organizationId: organizationA.id, actorUserId: adminA.id, window: { propertyId: propertyA.id, roomTypeId: roomTypeA.id, startDate: dateAt(1), endDate: dateAt(3), capacityLimit: 1 } });

    const windowPage = await windows.listHospitalityAvailabilityWindowsPage({
      organizationId: organizationA.id,
      actorUserId: staffA.id,
      propertyId: propertyA.id,
      roomTypeId: roomTypeA.id,
      page: 1,
      pageSize: 1,
    });
    assert.equal(windowPage.total, 1);
    assert.equal(windowPage.page, 1);
    assert.equal(windowPage.pageSize, 1);
    assert.deepEqual(windowPage.windows.map((window) => window.id), [capacityWindow.id]);

    const crossTenantWindowPage = await windows.listHospitalityAvailabilityWindowsPage({
      organizationId: organizationB.id,
      actorUserId: adminB.id,
      propertyId: propertyA.id,
      roomTypeId: roomTypeA.id,
      page: 1,
      pageSize: 20,
    });
    assert.equal(crossTenantWindowPage.total, 0);
    assert.equal(crossTenantWindowPage.windows.length, 0);

    await assert.rejects(
      windows.createHospitalityAvailabilityWindow({ organizationId: organizationA.id, actorUserId: adminA.id, window: { propertyId: propertyA.id, roomTypeId: roomTypeA.id, startDate: dateAt(3), endDate: dateAt(5), capacityLimit: 1 } }),
      /overlaps/i,
    );

    const windowLimited = await availability.readHospitalityAvailability({ organizationId: organizationA.id, actorUserId: staffA.id, request: { propertyId: propertyA.id, roomTypeId: roomTypeA.id, ratePlanId: ratePlanA.id, arrivalDate: dateAt(1), departureDate: dateAt(4), quantity: 2 } });
    assert.equal(windowLimited.capacity.physicalUnits, 2);
    assert.equal(windowLimited.capacity.sellableUnits, 1);
    assert.equal(windowLimited.available, false);
    assert.ok(windowLimited.unavailableReasons.includes('insufficient-capacity'));

    const restricted = await availability.readHospitalityAvailability({ organizationId: organizationA.id, actorUserId: staffA.id, request: { propertyId: propertyA.id, roomTypeId: roomTypeA.id, ratePlanId: ratePlanA.id, arrivalDate: dateAt(1), departureDate: dateAt(3), quantity: 1 } });
    assert.equal(restricted.available, false);
    assert.ok(restricted.unavailableReasons.includes('minimum-stay'));

    await assert.rejects(availability.readHospitalityAvailability({ organizationId: organizationB.id, actorUserId: adminB.id, request: { propertyId: propertyA.id, roomTypeId: roomTypeA.id, ratePlanId: ratePlanA.id, arrivalDate: dateAt(1), departureDate: dateAt(4), quantity: 1 } }), /same property|not available/i);
    await assert.rejects(windows.archiveHospitalityAvailabilityWindow({ organizationId: organizationB.id, actorUserId: adminB.id, windowId: capacityWindow.id }), /not available/i);
    await windows.archiveHospitalityAvailabilityWindow({ organizationId: organizationA.id, actorUserId: adminA.id, windowId: capacityWindow.id });
    const restored = await availability.readHospitalityAvailability({ organizationId: organizationA.id, actorUserId: staffA.id, request: { propertyId: propertyA.id, roomTypeId: roomTypeA.id, ratePlanId: ratePlanA.id, arrivalDate: dateAt(1), departureDate: dateAt(4), quantity: 2 } });
    assert.equal(restored.capacity.sellableUnits, 2);
  } finally {
    await cleanupFixtures();
  }
});
