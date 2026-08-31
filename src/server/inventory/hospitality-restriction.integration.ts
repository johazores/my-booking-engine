import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) {
  throw new Error('Hospitality restriction integration tests must run through npm run test:database with TEST_DATABASE_URL.');
}

test('hospitality restrictions enforce tenant scope, assignment dependencies, overlap rules, permissions, lifecycle, and audit', async () => {
  const [{ db }, hospitality, ratePlans, restrictions] = await Promise.all([
    import('../database.ts'),
    import('./hospitality-service.ts'),
    import('./hospitality-rate-plan-service.ts'),
    import('./hospitality-restriction-service.ts'),
  ]);

  const runId = crypto.randomUUID();
  const adminA = await db.user.create({ data: { email: `restriction-admin-a-${runId}@example.test`, status: 'ACTIVE' } });
  const staffA = await db.user.create({ data: { email: `restriction-staff-a-${runId}@example.test`, status: 'ACTIVE' } });
  const adminB = await db.user.create({ data: { email: `restriction-admin-b-${runId}@example.test`, status: 'ACTIVE' } });
  const organizationA = await db.organization.create({ data: { name: 'Restriction Tenant A', slug: `restriction-a-${runId}`.slice(0, 63), kind: 'HOTEL' } });
  const organizationB = await db.organization.create({ data: { name: 'Restriction Tenant B', slug: `restriction-b-${runId}`.slice(0, 63), kind: 'HOTEL' } });
  await db.organizationMembership.createMany({
    data: [
      { organizationId: organizationA.id, userId: adminA.id, status: 'ACTIVE', role: 'ADMIN' },
      { organizationId: organizationA.id, userId: staffA.id, status: 'ACTIVE', role: 'STAFF' },
      { organizationId: organizationB.id, userId: adminB.id, status: 'ACTIVE', role: 'ADMIN' },
    ],
  });

  try {
    const propertyA = await hospitality.createHospitalityProperty({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      property: { name: 'Restriction Hotel A', code: 'RSTA', timezone: 'Asia/Manila', addressLine1: '', city: 'Quezon City', region: '', postalCode: '', countryCode: 'PH' },
    });
    const propertyB = await hospitality.createHospitalityProperty({
      organizationId: organizationB.id,
      actorUserId: adminB.id,
      property: { name: 'Restriction Hotel B', code: 'RSTB', timezone: 'Asia/Manila', addressLine1: '', city: 'Manila', region: '', postalCode: '', countryCode: 'PH' },
    });
    const roomTypeA = await hospitality.createHospitalityRoomType({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      roomType: { propertyId: propertyA.id, name: 'Deluxe', code: 'DLX', maxOccupancy: '2', bedsDescription: '1 king bed' },
    });
    const unassignedRoomTypeA = await hospitality.createHospitalityRoomType({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      roomType: { propertyId: propertyA.id, name: 'Suite', code: 'STE', maxOccupancy: '4', bedsDescription: '2 beds' },
    });
    const ratePlanA = await ratePlans.createHospitalityRatePlan({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      ratePlan: { propertyId: propertyA.id, name: 'Flexible', code: 'FLEX', description: '' },
    });
    const ratePlanB = await ratePlans.createHospitalityRatePlan({
      organizationId: organizationB.id,
      actorUserId: adminB.id,
      ratePlan: { propertyId: propertyB.id, name: 'Other', code: 'OTHER', description: '' },
    });
    await ratePlans.assignHospitalityRatePlanToRoomType({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      propertyId: propertyA.id,
      roomTypeId: roomTypeA.id,
      ratePlanId: ratePlanA.id,
    });

    await assert.rejects(
      restrictions.createHospitalityRestriction({
        organizationId: organizationA.id,
        actorUserId: staffA.id,
        restriction: { propertyId: propertyA.id, ratePlanId: ratePlanA.id, roomTypeId: '', startDate: '2026-12-01', endDate: '2026-12-05', minStayNights: '2', maxStayNights: '', closedToArrival: '', closedToDeparture: '' },
      }),
      /permission/i,
    );
    await assert.rejects(
      restrictions.createHospitalityRestriction({
        organizationId: organizationA.id,
        actorUserId: adminA.id,
        restriction: { propertyId: propertyA.id, ratePlanId: ratePlanB.id, roomTypeId: '', startDate: '2026-12-01', endDate: '2026-12-05', minStayNights: '2', maxStayNights: '', closedToArrival: '', closedToDeparture: '' },
      }),
      /rate plan is not active/i,
    );
    await assert.rejects(
      restrictions.createHospitalityRestriction({
        organizationId: organizationA.id,
        actorUserId: adminA.id,
        restriction: { propertyId: propertyA.id, ratePlanId: ratePlanA.id, roomTypeId: unassignedRoomTypeA.id, startDate: '2026-12-01', endDate: '2026-12-05', minStayNights: '2', maxStayNights: '', closedToArrival: '', closedToDeparture: '' },
      }),
      /must be active and assigned/i,
    );

    const propertyRule = await restrictions.createHospitalityRestriction({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      restriction: { propertyId: propertyA.id, ratePlanId: ratePlanA.id, roomTypeId: '', startDate: '2026-12-20', endDate: '2026-12-31', minStayNights: '3', maxStayNights: '', closedToArrival: '', closedToDeparture: 'true' },
    });
    const roomRule = await restrictions.createHospitalityRestriction({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      restriction: { propertyId: propertyA.id, ratePlanId: ratePlanA.id, roomTypeId: roomTypeA.id, startDate: '2026-12-20', endDate: '2026-12-31', minStayNights: '', maxStayNights: '7', closedToArrival: 'true', closedToDeparture: '' },
    });

    await assert.rejects(
      restrictions.createHospitalityRestriction({
        organizationId: organizationA.id,
        actorUserId: adminA.id,
        restriction: { propertyId: propertyA.id, ratePlanId: ratePlanA.id, roomTypeId: roomTypeA.id, startDate: '2026-12-25', endDate: '2027-01-02', minStayNights: '2', maxStayNights: '', closedToArrival: '', closedToDeparture: '' },
      }),
      /overlaps/i,
    );

    const roomRules = await restrictions.listHospitalityRestrictions({
      organizationId: organizationA.id,
      actorUserId: staffA.id,
      propertyId: propertyA.id,
      ratePlanId: ratePlanA.id,
      roomTypeId: roomTypeA.id,
      page: 1,
      pageSize: 20,
    });
    assert.deepEqual(roomRules.restrictions.map((rule) => rule.id), [roomRule.id]);

    await assert.rejects(
      ratePlans.removeHospitalityRatePlanFromRoomType({ organizationId: organizationA.id, actorUserId: adminA.id, propertyId: propertyA.id, roomTypeId: roomTypeA.id, ratePlanId: ratePlanA.id }),
      /archive active room-type restrictions/i,
    );
    await restrictions.archiveHospitalityRestriction({ organizationId: organizationA.id, actorUserId: adminA.id, propertyId: propertyA.id, ratePlanId: ratePlanA.id, restrictionId: roomRule.id, confirmation: 'ARCHIVE' });
    await ratePlans.removeHospitalityRatePlanFromRoomType({ organizationId: organizationA.id, actorUserId: adminA.id, propertyId: propertyA.id, roomTypeId: roomTypeA.id, ratePlanId: ratePlanA.id });

    await assert.rejects(
      ratePlans.archiveHospitalityRatePlan({ organizationId: organizationA.id, actorUserId: adminA.id, propertyId: propertyA.id, ratePlanId: ratePlanA.id, confirmation: 'ARCHIVE' }),
      /archive active restrictions/i,
    );
    await restrictions.archiveHospitalityRestriction({ organizationId: organizationA.id, actorUserId: adminA.id, propertyId: propertyA.id, ratePlanId: ratePlanA.id, restrictionId: propertyRule.id, confirmation: 'ARCHIVE' });

    await hospitality.archiveHospitalityRoomType({ organizationId: organizationA.id, actorUserId: adminA.id, roomTypeId: roomTypeA.id, confirmation: 'ARCHIVE' });
    await hospitality.archiveHospitalityRoomType({ organizationId: organizationA.id, actorUserId: adminA.id, roomTypeId: unassignedRoomTypeA.id, confirmation: 'ARCHIVE' });
    await assert.rejects(
      hospitality.archiveHospitalityProperty({ organizationId: organizationA.id, actorUserId: adminA.id, propertyId: propertyA.id, confirmation: 'ARCHIVE' }),
      /archive active rate plans/i,
    );
    await ratePlans.archiveHospitalityRatePlan({ organizationId: organizationA.id, actorUserId: adminA.id, propertyId: propertyA.id, ratePlanId: ratePlanA.id, confirmation: 'ARCHIVE' });
    await hospitality.archiveHospitalityProperty({ organizationId: organizationA.id, actorUserId: adminA.id, propertyId: propertyA.id, confirmation: 'ARCHIVE' });

    const events = await db.auditEvent.findMany({ where: { organizationId: organizationA.id, resourceType: 'hospitality-restriction' } });
    assert.ok(events.some((event) => event.action === 'inventory.restriction.created'));
    assert.ok(events.some((event) => event.action === 'inventory.restriction.archived'));
  } finally {
    await db.auditEvent.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.hospitalityRestriction.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.hospitalityRoomTypeRatePlan.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.hospitalityRatePlan.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.hospitalityRoom.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.hospitalityRoomType.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.hospitalityProperty.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.organizationMembership.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.organization.deleteMany({ where: { id: { in: [organizationA.id, organizationB.id] } } });
    await db.user.deleteMany({ where: { id: { in: [adminA.id, staffA.id, adminB.id] } } });
  }
});
