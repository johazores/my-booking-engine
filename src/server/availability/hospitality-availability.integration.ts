import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) throw new Error('Availability integration tests must run through npm run test:database with TEST_DATABASE_URL.');

test('hospitality availability enforces tenant scope, physical capacity, permissions, and effective restrictions', async () => {
  const [{ db }, availability] = await Promise.all([import('../database.ts'), import('./hospitality-availability-service.ts')]);
  const runId = crypto.randomUUID();
  const adminA = await db.user.create({ data: { email: `availability-admin-a-${runId}@example.test`, status: 'ACTIVE' } });
  const staffA = await db.user.create({ data: { email: `availability-staff-a-${runId}@example.test`, status: 'ACTIVE' } });
  const adminB = await db.user.create({ data: { email: `availability-admin-b-${runId}@example.test`, status: 'ACTIVE' } });
  const organizationA = await db.organization.create({ data: { name: 'Availability Tenant A', slug: `availability-a-${runId}`.slice(0, 63), kind: 'HOTEL' } });
  const organizationB = await db.organization.create({ data: { name: 'Availability Tenant B', slug: `availability-b-${runId}`.slice(0, 63), kind: 'HOTEL' } });
  await db.organizationMembership.createMany({ data: [
    { organizationId: organizationA.id, userId: adminA.id, status: 'ACTIVE', role: 'ADMIN' },
    { organizationId: organizationA.id, userId: staffA.id, status: 'ACTIVE', role: 'STAFF' },
    { organizationId: organizationB.id, userId: adminB.id, status: 'ACTIVE', role: 'ADMIN' },
  ] });

  try {
    const propertyA = await db.hospitalityProperty.create({ data: { organizationId: organizationA.id, name: 'A Hotel', code: 'AVA', timezone: 'UTC', countryCode: 'US' } });
    const roomTypeA = await db.hospitalityRoomType.create({ data: { organizationId: organizationA.id, propertyId: propertyA.id, name: 'King', code: 'KING', maxOccupancy: 2 } });
    await db.hospitalityRoom.createMany({ data: [
      { organizationId: organizationA.id, propertyId: propertyA.id, roomTypeId: roomTypeA.id, code: '101' },
      { organizationId: organizationA.id, propertyId: propertyA.id, roomTypeId: roomTypeA.id, code: '102' },
      { organizationId: organizationA.id, propertyId: propertyA.id, roomTypeId: roomTypeA.id, code: '103', status: 'OUT_OF_SERVICE' },
    ] });
    const ratePlanA = await db.hospitalityRatePlan.create({ data: { organizationId: organizationA.id, propertyId: propertyA.id, name: 'Flexible', code: 'FLEX' } });
    await db.hospitalityRoomTypeRatePlan.create({ data: { organizationId: organizationA.id, propertyId: propertyA.id, roomTypeId: roomTypeA.id, ratePlanId: ratePlanA.id } });
    await db.hospitalityRestriction.create({ data: { organizationId: organizationA.id, propertyId: propertyA.id, roomTypeId: roomTypeA.id, ratePlanId: ratePlanA.id, startDate: new Date('2026-09-10T00:00:00Z'), endDate: new Date('2026-09-20T00:00:00Z'), minStayNights: 3 } });

    const available = await availability.readHospitalityAvailability({ organizationId: organizationA.id, actorUserId: staffA.id, request: { propertyId: propertyA.id, roomTypeId: roomTypeA.id, ratePlanId: ratePlanA.id, arrivalDate: '2026-09-11', departureDate: '2026-09-14', quantity: 2 } });
    assert.equal(available.capacity.physicalUnits, 2);
    assert.equal(available.available, true);

    const restricted = await availability.readHospitalityAvailability({ organizationId: organizationA.id, actorUserId: staffA.id, request: { propertyId: propertyA.id, roomTypeId: roomTypeA.id, ratePlanId: ratePlanA.id, arrivalDate: '2026-09-11', departureDate: '2026-09-13', quantity: 1 } });
    assert.equal(restricted.available, false);
    assert.ok(restricted.unavailableReasons.includes('minimum-stay'));

    const overCapacity = await availability.readHospitalityAvailability({ organizationId: organizationA.id, actorUserId: staffA.id, request: { propertyId: propertyA.id, roomTypeId: roomTypeA.id, ratePlanId: ratePlanA.id, arrivalDate: '2026-09-11', departureDate: '2026-09-14', quantity: 3 } });
    assert.equal(overCapacity.available, false);
    assert.ok(overCapacity.unavailableReasons.includes('insufficient-capacity'));

    await assert.rejects(availability.readHospitalityAvailability({ organizationId: organizationB.id, actorUserId: adminB.id, request: { propertyId: propertyA.id, roomTypeId: roomTypeA.id, ratePlanId: ratePlanA.id, arrivalDate: '2026-09-11', departureDate: '2026-09-14', quantity: 1 } }), /same property|not available/i);
  } finally {
    await db.auditEvent.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.hospitalityRestriction.deleteMany({ where: { organizationId: organizationA.id } });
    await db.hospitalityRoomTypeRatePlan.deleteMany({ where: { organizationId: organizationA.id } });
    await db.hospitalityRatePlan.deleteMany({ where: { organizationId: organizationA.id } });
    await db.hospitalityRoom.deleteMany({ where: { organizationId: organizationA.id } });
    await db.hospitalityRoomType.deleteMany({ where: { organizationId: organizationA.id } });
    await db.hospitalityProperty.deleteMany({ where: { organizationId: organizationA.id } });
    await db.organizationMembership.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.organization.deleteMany({ where: { id: { in: [organizationA.id, organizationB.id] } } });
    await db.user.deleteMany({ where: { id: { in: [adminA.id, staffA.id, adminB.id] } } });
  }
});
