import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) {
  throw new Error('Hospitality inventory integration tests must run through npm run test:database with TEST_DATABASE_URL.');
}

test('hospitality inventory enforces tenant scope, hierarchy, permissions, lifecycle, and audit', async () => {
  const [{ db }, inventory] = await Promise.all([
    import('../database.ts'),
    import('./hospitality-service.ts'),
  ]);

  const runId = crypto.randomUUID();
  const adminA = await db.user.create({ data: { email: `inventory-admin-a-${runId}@example.test`, status: 'ACTIVE' } });
  const staffA = await db.user.create({ data: { email: `inventory-staff-a-${runId}@example.test`, status: 'ACTIVE' } });
  const adminB = await db.user.create({ data: { email: `inventory-admin-b-${runId}@example.test`, status: 'ACTIVE' } });
  const organizationA = await db.organization.create({ data: { name: 'Inventory Tenant A', slug: `inventory-a-${runId}`.slice(0, 63), kind: 'HOTEL' } });
  const organizationB = await db.organization.create({ data: { name: 'Inventory Tenant B', slug: `inventory-b-${runId}`.slice(0, 63), kind: 'HOTEL' } });
  await db.organizationMembership.createMany({
    data: [
      { organizationId: organizationA.id, userId: adminA.id, status: 'ACTIVE', role: 'ADMIN' },
      { organizationId: organizationA.id, userId: staffA.id, status: 'ACTIVE', role: 'STAFF' },
      { organizationId: organizationB.id, userId: adminB.id, status: 'ACTIVE', role: 'ADMIN' },
    ],
  });

  try {
    const propertyA = await inventory.createHospitalityProperty({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      property: { name: 'Northstar Hotel', code: 'NST', timezone: 'Asia/Manila', addressLine1: '', city: 'Quezon City', region: '', postalCode: '', countryCode: 'PH' },
    });
    const propertyB = await inventory.createHospitalityProperty({
      organizationId: organizationB.id,
      actorUserId: adminB.id,
      property: { name: 'Other Hotel', code: 'OTH', timezone: 'Asia/Manila', addressLine1: '', city: 'Manila', region: '', postalCode: '', countryCode: 'PH' },
    });

    await assert.rejects(
      inventory.createHospitalityRoomType({
        organizationId: organizationA.id,
        actorUserId: adminA.id,
        roomType: { propertyId: propertyB.id, name: 'Cross tenant', code: 'CROSS', maxOccupancy: '2', bedsDescription: '' },
      }),
      /property is not available/i,
    );
    await assert.rejects(
      inventory.createHospitalityProperty({
        organizationId: organizationA.id,
        actorUserId: staffA.id,
        property: { name: 'Staff Property', code: 'STAFF', timezone: 'UTC', addressLine1: '', city: '', region: '', postalCode: '', countryCode: 'US' },
      }),
      /permission/i,
    );

    const roomType = await inventory.createHospitalityRoomType({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      roomType: { propertyId: propertyA.id, name: 'Deluxe King', code: 'DLX', maxOccupancy: '3', bedsDescription: '1 king bed' },
    });
    const room = await inventory.createHospitalityRoom({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      room: { propertyId: propertyA.id, roomTypeId: roomType.id, code: '101', floor: '1' },
    });

    const tenantAInventory = await inventory.listHospitalityProperties({ organizationId: organizationA.id, actorUserId: staffA.id, page: 1, pageSize: 20 });
    assert.deepEqual(tenantAInventory.properties.map((property) => property.id), [propertyA.id]);
    const roomTypes = await inventory.listHospitalityRoomTypes({ organizationId: organizationA.id, actorUserId: staffA.id, propertyId: propertyA.id, page: 1, pageSize: 20 });
    assert.equal(roomTypes.roomTypes[0]?.id, roomType.id);
    const rooms = await inventory.listHospitalityRooms({ organizationId: organizationA.id, actorUserId: staffA.id, propertyId: propertyA.id, roomTypeId: roomType.id, page: 1, pageSize: 20 });
    assert.equal(rooms.rooms[0]?.id, room.id);

    await assert.rejects(
      inventory.archiveHospitalityRoomType({ organizationId: organizationA.id, actorUserId: adminA.id, roomTypeId: roomType.id, confirmation: 'ARCHIVE' }),
      /archive rooms/i,
    );
    await inventory.archiveHospitalityRoom({ organizationId: organizationA.id, actorUserId: adminA.id, roomId: room.id, confirmation: 'ARCHIVE' });
    await inventory.archiveHospitalityRoomType({ organizationId: organizationA.id, actorUserId: adminA.id, roomTypeId: roomType.id, confirmation: 'ARCHIVE' });
    await inventory.archiveHospitalityProperty({ organizationId: organizationA.id, actorUserId: adminA.id, propertyId: propertyA.id, confirmation: 'ARCHIVE' });

    const events = await db.auditEvent.findMany({ where: { organizationId: organizationA.id, resourceType: { startsWith: 'hospitality-' } } });
    assert.ok(events.some((event) => event.action === 'inventory.property.created'));
    assert.ok(events.some((event) => event.action === 'inventory.room.archived'));
  } finally {
    await db.auditEvent.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.hospitalityRoom.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.hospitalityRoomType.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.hospitalityProperty.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.organizationMembership.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.organization.deleteMany({ where: { id: { in: [organizationA.id, organizationB.id] } } });
    await db.user.deleteMany({ where: { id: { in: [adminA.id, staffA.id, adminB.id] } } });
  }
});
