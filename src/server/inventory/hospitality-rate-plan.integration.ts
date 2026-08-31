import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) {
  throw new Error('Hospitality rate plan integration tests must run through npm run test:database with TEST_DATABASE_URL.');
}

test('hospitality rate plans enforce tenant scope, assignment lifecycle, idempotency, and audit', async () => {
  const [{ db }, inventory, ratePlans] = await Promise.all([
    import('../database.ts'),
    import('./hospitality-service.ts'),
    import('./hospitality-rate-plan-service.ts'),
  ]);

  const runId = crypto.randomUUID();
  const adminA = await db.user.create({ data: { email: `rate-admin-a-${runId}@example.test`, status: 'ACTIVE' } });
  const staffA = await db.user.create({ data: { email: `rate-staff-a-${runId}@example.test`, status: 'ACTIVE' } });
  const adminB = await db.user.create({ data: { email: `rate-admin-b-${runId}@example.test`, status: 'ACTIVE' } });
  const organizationA = await db.organization.create({ data: { name: 'Rate Tenant A', slug: `rate-a-${runId}`.slice(0, 63), kind: 'HOTEL' } });
  const organizationB = await db.organization.create({ data: { name: 'Rate Tenant B', slug: `rate-b-${runId}`.slice(0, 63), kind: 'HOTEL' } });
  await db.organizationMembership.createMany({ data: [
    { organizationId: organizationA.id, userId: adminA.id, status: 'ACTIVE', role: 'ADMIN' },
    { organizationId: organizationA.id, userId: staffA.id, status: 'ACTIVE', role: 'STAFF' },
    { organizationId: organizationB.id, userId: adminB.id, status: 'ACTIVE', role: 'ADMIN' },
  ] });

  try {
    const propertyA = await inventory.createHospitalityProperty({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      property: { name: 'Rate Hotel A', code: 'RATEA', timezone: 'Asia/Manila', addressLine1: '', city: 'Quezon City', region: '', postalCode: '', countryCode: 'PH' },
    });
    const propertyB = await inventory.createHospitalityProperty({
      organizationId: organizationB.id,
      actorUserId: adminB.id,
      property: { name: 'Rate Hotel B', code: 'RATEB', timezone: 'Asia/Manila', addressLine1: '', city: 'Manila', region: '', postalCode: '', countryCode: 'PH' },
    });
    const roomTypeA = await inventory.createHospitalityRoomType({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      roomType: { propertyId: propertyA.id, name: 'Deluxe', code: 'DLX', maxOccupancy: '2', bedsDescription: '1 king bed' },
    });
    const ratePlanA = await ratePlans.createHospitalityRatePlan({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      ratePlan: { propertyId: propertyA.id, name: 'Flexible', code: 'FLEX', description: 'Flexible commercial plan' },
    });
    const ratePlanB = await ratePlans.createHospitalityRatePlan({
      organizationId: organizationB.id,
      actorUserId: adminB.id,
      ratePlan: { propertyId: propertyB.id, name: 'Other', code: 'OTHER', description: '' },
    });

    await assert.rejects(
      ratePlans.createHospitalityRatePlan({
        organizationId: organizationA.id,
        actorUserId: adminA.id,
        ratePlan: { propertyId: propertyB.id, name: 'Cross tenant', code: 'CROSS', description: '' },
      }),
      /property is not available/i,
    );
    await assert.rejects(
      ratePlans.createHospitalityRatePlan({
        organizationId: organizationA.id,
        actorUserId: staffA.id,
        ratePlan: { propertyId: propertyA.id, name: 'Staff plan', code: 'STAFF', description: '' },
      }),
      /permission/i,
    );
    await assert.rejects(
      ratePlans.assignHospitalityRatePlanToRoomType({
        organizationId: organizationA.id,
        actorUserId: adminA.id,
        propertyId: propertyA.id,
        roomTypeId: roomTypeA.id,
        ratePlanId: ratePlanB.id,
      }),
      /not available/i,
    );

    await ratePlans.assignHospitalityRatePlanToRoomType({ organizationId: organizationA.id, actorUserId: adminA.id, propertyId: propertyA.id, roomTypeId: roomTypeA.id, ratePlanId: ratePlanA.id });
    await ratePlans.assignHospitalityRatePlanToRoomType({ organizationId: organizationA.id, actorUserId: adminA.id, propertyId: propertyA.id, roomTypeId: roomTypeA.id, ratePlanId: ratePlanA.id });

    const listed = await ratePlans.listHospitalityRatePlans({ organizationId: organizationA.id, actorUserId: staffA.id, propertyId: propertyA.id, page: 1, pageSize: 20 });
    assert.deepEqual(listed.ratePlans.map((plan) => plan.id), [ratePlanA.id]);
    const selection = await ratePlans.listHospitalityRatePlanRoomTypes({ organizationId: organizationA.id, actorUserId: staffA.id, propertyId: propertyA.id, ratePlanId: ratePlanA.id, page: 1, pageSize: 20 });
    assert.equal(selection.roomTypes[0]?.id, roomTypeA.id);
    assert.equal(selection.roomTypes[0]?.ratePlanAssignments.length, 1);

    const assignmentAudits = await db.auditEvent.count({ where: { organizationId: organizationA.id, action: 'inventory.rate-plan.assigned-room-type', resourceId: ratePlanA.id } });
    assert.equal(assignmentAudits, 1);
    await assert.rejects(
      ratePlans.archiveHospitalityRatePlan({ organizationId: organizationA.id, actorUserId: adminA.id, propertyId: propertyA.id, ratePlanId: ratePlanA.id, confirmation: 'ARCHIVE' }),
      /remove all room-type assignments/i,
    );

    await ratePlans.removeHospitalityRatePlanFromRoomType({ organizationId: organizationA.id, actorUserId: adminA.id, propertyId: propertyA.id, roomTypeId: roomTypeA.id, ratePlanId: ratePlanA.id });
    const archived = await ratePlans.archiveHospitalityRatePlan({ organizationId: organizationA.id, actorUserId: adminA.id, propertyId: propertyA.id, ratePlanId: ratePlanA.id, confirmation: 'ARCHIVE' });
    assert.equal(archived.status, 'ARCHIVED');
    const archiveAudit = await db.auditEvent.findFirst({ where: { organizationId: organizationA.id, action: 'inventory.rate-plan.archived', resourceId: ratePlanA.id } });
    assert.ok(archiveAudit);
  } finally {
    const organizationIds = [organizationA.id, organizationB.id];
    await db.auditEvent.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await db.hospitalityRoomTypeRatePlan.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await db.hospitalityRatePlan.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await db.hospitalityRoom.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await db.hospitalityRoomType.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await db.hospitalityProperty.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await db.organizationMembership.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await db.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await db.user.deleteMany({ where: { id: { in: [adminA.id, staffA.id, adminB.id] } } });
  }
});
