import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) {
  throw new Error('Hospitality inventory integration tests must run through npm run test:database with TEST_DATABASE_URL.');
}

test('hospitality inventory enforces tenant scope, hierarchy, amenities, images, permissions, lifecycle, and audit', async () => {
  const [{ db }, inventory, amenities, amenityAssignments, images] = await Promise.all([
    import('../database.ts'),
    import('./hospitality-service.ts'),
    import('./hospitality-amenity-service.ts'),
    import('./hospitality-amenity-assignment-service.ts'),
    import('./hospitality-image-service.ts'),
  ]);

  const runId = crypto.randomUUID();
  const adminA = await db.user.create({ data: { email: `inventory-admin-a-${runId}@example.test`, status: 'ACTIVE' } });
  const staffA = await db.user.create({ data: { email: `inventory-staff-a-${runId}@example.test`, status: 'ACTIVE' } });
  const adminB = await db.user.create({ data: { email: `inventory-admin-b-${runId}@example.test`, status: 'ACTIVE' } });
  const organizationA = await db.organization.create({ data: { name: 'Inventory Tenant A', slug: `inventory-a-${runId}`.slice(0, 63), kind: 'HOTEL' } });
  const organizationB = await db.organization.create({ data: { name: 'Inventory Tenant B', slug: `inventory-b-${runId}`.slice(0, 63), kind: 'HOTEL' } });
  await db.organizationMembership.createMany({ data: [
    { organizationId: organizationA.id, userId: adminA.id, status: 'ACTIVE', role: 'ADMIN' },
    { organizationId: organizationA.id, userId: staffA.id, status: 'ACTIVE', role: 'STAFF' },
    { organizationId: organizationB.id, userId: adminB.id, status: 'ACTIVE', role: 'ADMIN' },
  ] });

  try {
    const propertyA = await inventory.createHospitalityProperty({ organizationId: organizationA.id, actorUserId: adminA.id, property: { name: 'Northstar Hotel', code: 'NST', timezone: 'Asia/Manila', addressLine1: '', city: 'Quezon City', region: '', postalCode: '', countryCode: 'PH' } });
    const propertyB = await inventory.createHospitalityProperty({ organizationId: organizationB.id, actorUserId: adminB.id, property: { name: 'Other Hotel', code: 'OTH', timezone: 'Asia/Manila', addressLine1: '', city: 'Manila', region: '', postalCode: '', countryCode: 'PH' } });

    await assert.rejects(inventory.createHospitalityRoomType({ organizationId: organizationA.id, actorUserId: adminA.id, roomType: { propertyId: propertyB.id, name: 'Cross tenant', code: 'CROSS', maxOccupancy: '2', bedsDescription: '' } }), /property is not available/i);
    await assert.rejects(inventory.createHospitalityProperty({ organizationId: organizationA.id, actorUserId: staffA.id, property: { name: 'Staff Property', code: 'STAFF', timezone: 'UTC', addressLine1: '', city: '', region: '', postalCode: '', countryCode: 'US' } }), /permission/i);

    const roomType = await inventory.createHospitalityRoomType({ organizationId: organizationA.id, actorUserId: adminA.id, roomType: { propertyId: propertyA.id, name: 'Deluxe King', code: 'DLX', maxOccupancy: '3', bedsDescription: '1 king bed' } });
    const room = await inventory.createHospitalityRoom({ organizationId: organizationA.id, actorUserId: adminA.id, room: { propertyId: propertyA.id, roomTypeId: roomType.id, code: '101', floor: '1' } });

    const wifi = await amenities.createHospitalityAmenity({ organizationId: organizationA.id, actorUserId: adminA.id, amenity: { name: 'Wi-Fi', code: 'wifi' } });
    const foreignAmenity = await amenities.createHospitalityAmenity({ organizationId: organizationB.id, actorUserId: adminB.id, amenity: { name: 'Pool', code: 'pool' } });
    await amenityAssignments.assignHospitalityAmenityToProperty({ organizationId: organizationA.id, actorUserId: adminA.id, propertyId: propertyA.id, amenityId: wifi.id });
    await amenityAssignments.assignHospitalityAmenityToRoomType({ organizationId: organizationA.id, actorUserId: adminA.id, propertyId: propertyA.id, roomTypeId: roomType.id, amenityId: wifi.id });
    await amenityAssignments.assignHospitalityAmenityToProperty({ organizationId: organizationA.id, actorUserId: adminA.id, propertyId: propertyA.id, amenityId: wifi.id });
    await amenityAssignments.assignHospitalityAmenityToRoomType({ organizationId: organizationA.id, actorUserId: adminA.id, propertyId: propertyA.id, roomTypeId: roomType.id, amenityId: wifi.id });
    await assert.rejects(amenityAssignments.assignHospitalityAmenityToProperty({ organizationId: organizationA.id, actorUserId: adminA.id, propertyId: propertyA.id, amenityId: foreignAmenity.id }), /not available in this organization/i);
    await assert.rejects(amenities.archiveHospitalityAmenity({ organizationId: organizationA.id, actorUserId: adminA.id, amenityId: wifi.id, confirmation: 'ARCHIVE' }), /remove amenity assignments/i);

    const propertyImage = await images.createHospitalityImage({ organizationId: organizationA.id, actorUserId: adminA.id, propertyId: propertyA.id, image: { url: 'https://cdn.example.test/property-main.jpg', altText: 'Northstar Hotel exterior', sortOrder: '10', isPrimary: '' } });
    assert.equal(propertyImage.isPrimary, true);
    const propertyImageTwo = await images.createHospitalityImage({ organizationId: organizationA.id, actorUserId: adminA.id, propertyId: propertyA.id, image: { url: 'https://cdn.example.test/property-pool.jpg', altText: 'Northstar Hotel pool', sortOrder: '20', isPrimary: '' } });
    assert.equal(propertyImageTwo.isPrimary, false);
    await images.setPrimaryHospitalityImage({ organizationId: organizationA.id, actorUserId: adminA.id, propertyId: propertyA.id, imageId: propertyImageTwo.id });
    const roomTypeImage = await images.createHospitalityImage({ organizationId: organizationA.id, actorUserId: adminA.id, propertyId: propertyA.id, roomTypeId: roomType.id, image: { url: 'https://cdn.example.test/deluxe.jpg', altText: 'Deluxe King room', sortOrder: '0', isPrimary: '' } });
    assert.equal(roomTypeImage.isPrimary, true);
    await assert.rejects(images.createHospitalityImage({ organizationId: organizationA.id, actorUserId: staffA.id, propertyId: propertyA.id, image: { url: 'https://cdn.example.test/staff.jpg', altText: 'Denied image', sortOrder: '0', isPrimary: '' } }), /permission/i);
    await assert.rejects(images.removeHospitalityImage({ organizationId: organizationB.id, actorUserId: adminB.id, propertyId: propertyA.id, imageId: propertyImage.id }), /not available/i);

    const tenantAInventory = await inventory.listHospitalityProperties({ organizationId: organizationA.id, actorUserId: staffA.id, page: 1, pageSize: 20 });
    assert.deepEqual(tenantAInventory.properties.map((property) => property.id), [propertyA.id]);
    const propertyAmenities = await amenities.listHospitalityPropertyAmenities({ organizationId: organizationA.id, actorUserId: staffA.id, propertyId: propertyA.id });
    assert.deepEqual(propertyAmenities.map((assignment) => assignment.amenityId), [wifi.id]);
    const roomTypeAmenities = await amenities.listHospitalityRoomTypeAmenities({ organizationId: organizationA.id, actorUserId: staffA.id, propertyId: propertyA.id, roomTypeId: roomType.id });
    assert.deepEqual(roomTypeAmenities.map((assignment) => assignment.amenityId), [wifi.id]);
    const propertyImages = await images.listHospitalityImages({ organizationId: organizationA.id, actorUserId: staffA.id, propertyId: propertyA.id });
    assert.deepEqual(propertyImages.map((image) => image.id), [propertyImageTwo.id, propertyImage.id]);
    const roomTypeImages = await images.listHospitalityImages({ organizationId: organizationA.id, actorUserId: staffA.id, propertyId: propertyA.id, roomTypeId: roomType.id });
    assert.deepEqual(roomTypeImages.map((image) => image.id), [roomTypeImage.id]);

    const assignmentEvents = await db.auditEvent.findMany({
      where: {
        organizationId: organizationA.id,
        resourceId: wifi.id,
        action: { in: ['inventory.amenity.assigned-property', 'inventory.amenity.assigned-room-type'] },
      },
    });
    assert.equal(assignmentEvents.filter((event) => event.action === 'inventory.amenity.assigned-property').length, 1);
    assert.equal(assignmentEvents.filter((event) => event.action === 'inventory.amenity.assigned-room-type').length, 1);

    await amenityAssignments.removeHospitalityAmenityFromRoomType({ organizationId: organizationA.id, actorUserId: adminA.id, propertyId: propertyA.id, roomTypeId: roomType.id, amenityId: wifi.id });
    await amenityAssignments.removeHospitalityAmenityFromProperty({ organizationId: organizationA.id, actorUserId: adminA.id, propertyId: propertyA.id, amenityId: wifi.id });
    await amenities.archiveHospitalityAmenity({ organizationId: organizationA.id, actorUserId: adminA.id, amenityId: wifi.id, confirmation: 'ARCHIVE' });

    await assert.rejects(inventory.archiveHospitalityRoomType({ organizationId: organizationA.id, actorUserId: adminA.id, roomTypeId: roomType.id, confirmation: 'ARCHIVE' }), /archive rooms/i);
    await inventory.archiveHospitalityRoom({ organizationId: organizationA.id, actorUserId: adminA.id, roomId: room.id, confirmation: 'ARCHIVE' });
    await inventory.archiveHospitalityRoomType({ organizationId: organizationA.id, actorUserId: adminA.id, roomTypeId: roomType.id, confirmation: 'ARCHIVE' });
    await inventory.archiveHospitalityProperty({ organizationId: organizationA.id, actorUserId: adminA.id, propertyId: propertyA.id, confirmation: 'ARCHIVE' });
    await assert.rejects(images.removeHospitalityImage({ organizationId: organizationA.id, actorUserId: adminA.id, propertyId: propertyA.id, imageId: propertyImage.id }), /active inventory scope/i);

    const events = await db.auditEvent.findMany({ where: { organizationId: organizationA.id, resourceType: { startsWith: 'hospitality-' } } });
    assert.ok(events.some((event) => event.action === 'inventory.property.created'));
    assert.ok(events.some((event) => event.action === 'inventory.amenity.assigned-room-type'));
    assert.ok(events.some((event) => event.action === 'inventory.amenity.archived'));
    assert.ok(events.some((event) => event.action === 'inventory.image.created-property'));
    assert.ok(events.some((event) => event.action === 'inventory.image.primary-property'));
    assert.ok(events.some((event) => event.action === 'inventory.image.created-room-type'));
    assert.ok(events.some((event) => event.action === 'inventory.room.archived'));
  } finally {
    await db.auditEvent.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.hospitalityRoomTypeImage.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.hospitalityPropertyImage.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.hospitalityRoomTypeAmenity.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.hospitalityPropertyAmenity.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.hospitalityRoom.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.hospitalityRoomType.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.hospitalityAmenity.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.hospitalityProperty.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.organizationMembership.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.organization.deleteMany({ where: { id: { in: [organizationA.id, organizationB.id] } } });
    await db.user.deleteMany({ where: { id: { in: [adminA.id, staffA.id, adminB.id] } } });
  }
});
