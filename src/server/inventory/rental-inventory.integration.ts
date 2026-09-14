import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) {
  throw new Error('Rental inventory integration tests must run through npm run test:database with TEST_DATABASE_URL.');
}

test('rental inventory enforces tenant scope, permissions, location ownership, calendar/rate conflicts, lifecycle, and audit', async () => {
  const [{ db }, rentals] = await Promise.all([
    import('../database.ts'),
    import('./rental-service.ts'),
  ]);

  const runId = crypto.randomUUID();
  const adminA = await db.user.create({ data: { email: `rental-admin-a-${runId}@example.test`, status: 'ACTIVE' } });
  const staffUserA = await db.user.create({ data: { email: `rental-staff-a-${runId}@example.test`, status: 'ACTIVE' } });
  const adminB = await db.user.create({ data: { email: `rental-admin-b-${runId}@example.test`, status: 'ACTIVE' } });
  const organizationA = await db.organization.create({
    data: {
      name: 'Rental Tenant A',
      slug: `rental-a-${runId}`.slice(0, 63),
      kind: 'RENTAL_BUSINESS',
      timezone: 'Asia/Manila',
    },
  });
  const organizationB = await db.organization.create({
    data: {
      name: 'Rental Tenant B',
      slug: `rental-b-${runId}`.slice(0, 63),
      kind: 'RENTAL_BUSINESS',
      timezone: 'Asia/Manila',
    },
  });
  await db.organizationMembership.createMany({ data: [
    { organizationId: organizationA.id, userId: adminA.id, status: 'ACTIVE', role: 'ADMIN' },
    { organizationId: organizationA.id, userId: staffUserA.id, status: 'ACTIVE', role: 'STAFF' },
    { organizationId: organizationB.id, userId: adminB.id, status: 'ACTIVE', role: 'ADMIN' },
  ] });

  try {
    const locationA = await rentals.createRentalLocation({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      location: {
        name: 'Makati Depot',
        code: 'MAKATI',
        addressLine1: '123 Ayala Avenue',
        addressLine2: '',
        city: 'Makati',
        region: 'NCR',
        postalCode: '1200',
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    const secondLocationA = await rentals.createRentalLocation({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      location: {
        name: 'Quezon City Depot',
        code: 'QC',
        addressLine1: '1 Commonwealth Avenue',
        addressLine2: '',
        city: 'Quezon City',
        region: 'NCR',
        postalCode: '1100',
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    const foreignLocation = await rentals.createRentalLocation({
      organizationId: organizationB.id,
      actorUserId: adminB.id,
      location: {
        name: 'Foreign Depot',
        code: 'FOREIGN',
        addressLine1: '1 Other Street',
        addressLine2: '',
        city: 'Cebu City',
        region: 'Cebu',
        postalCode: '6000',
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    const unitTypeA = await rentals.createRentalUnitType({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      unitType: {
        name: 'City Bike',
        code: 'CITY-BIKE',
        description: 'Daily bike rental',
        currency: 'PHP',
        defaultDailyRateMinor: 125000,
      },
    });

    await assert.rejects(
      rentals.createRentalLocation({
        organizationId: organizationA.id,
        actorUserId: staffUserA.id,
        location: {
          name: 'Denied', code: 'DENIED', addressLine1: '1 Denied', addressLine2: '', city: 'Makati', region: '', postalCode: '', countryCode: 'PH', timeZone: 'Asia/Manila',
        },
      }),
      /permission/i,
    );

    await assert.rejects(
      rentals.createRentalUnit({
        organizationId: organizationA.id,
        actorUserId: adminA.id,
        unit: { unitTypeId: unitTypeA.id, locationCode: foreignLocation.code, name: 'Cross tenant unit', code: 'CROSS', description: '' },
      }),
      /location is not active in this organization/i,
    );

    const unitA = await rentals.createRentalUnit({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      unit: { unitTypeId: unitTypeA.id, locationCode: locationA.code, name: 'Bike 001', code: 'BIKE-001', description: '' },
    });

    await assert.rejects(
      rentals.readRentalLocationInventory({
        organizationId: organizationB.id,
        actorUserId: adminB.id,
        locationId: locationA.id,
        unitPage: 1,
        pageSize: 20,
      }),
      /not active in this organization/i,
    );

    const overview = await rentals.listRentalInventory({
      organizationId: organizationA.id,
      actorUserId: staffUserA.id,
      unitTypePage: 1,
      locationPage: 1,
      unitPage: 1,
      pageSize: 20,
    });
    assert.deepEqual(overview.unitTypes.items.map((item) => item.id), [unitTypeA.id]);
    assert.deepEqual(new Set(overview.locations.items.map((item) => item.id)), new Set([locationA.id, secondLocationA.id]));
    assert.deepEqual(overview.units.items.map((item) => item.id), [unitA.id]);

    const block = await rentals.createRentalAvailabilityBlock({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      block: { unitId: unitA.id, startsOn: '2026-10-01', endsOn: '2026-10-04', reason: 'Maintenance' },
    });
    await assert.rejects(
      rentals.createRentalAvailabilityBlock({
        organizationId: organizationA.id,
        actorUserId: adminA.id,
        block: { unitId: unitA.id, startsOn: '2026-10-03', endsOn: '2026-10-05', reason: 'Overlap' },
      }),
      /overlaps an existing block/i,
    );

    const rate = await rentals.createRentalRatePeriod({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      rate: { unitTypeId: unitTypeA.id, startsOn: '2026-12-20', endsOn: '2027-01-05', dailyRateMinor: 150000 },
    });
    await assert.rejects(
      rentals.createRentalRatePeriod({
        organizationId: organizationA.id,
        actorUserId: adminA.id,
        rate: { unitTypeId: unitTypeA.id, startsOn: '2026-12-24', endsOn: '2026-12-26', dailyRateMinor: 160000 },
      }),
      /overlaps an existing pricing period/i,
    );

    await assert.rejects(
      rentals.archiveRentalLocation({
        organizationId: organizationA.id,
        actorUserId: adminA.id,
        locationId: locationA.id,
        confirmation: 'ARCHIVE',
      }),
      /move or archive active rental units/i,
    );

    const relocationAuditBefore = await db.auditEvent.count({
      where: { organizationId: organizationA.id, action: 'inventory.rental-unit.location-assigned', resourceId: unitA.id },
    });
    await rentals.assignRentalUnitLocation({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      unitId: unitA.id,
      locationCode: secondLocationA.code,
    });
    await rentals.assignRentalUnitLocation({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      unitId: unitA.id,
      locationCode: secondLocationA.code,
    });
    const relocationAuditAfter = await db.auditEvent.count({
      where: { organizationId: organizationA.id, action: 'inventory.rental-unit.location-assigned', resourceId: unitA.id },
    });
    assert.equal(relocationAuditAfter, relocationAuditBefore + 1);

    await rentals.archiveRentalLocation({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      locationId: locationA.id,
      confirmation: 'ARCHIVE',
    });
    await assert.rejects(
      rentals.archiveRentalLocation({
        organizationId: organizationA.id,
        actorUserId: adminA.id,
        locationId: secondLocationA.id,
        confirmation: 'ARCHIVE',
      }),
      /move or archive active rental units/i,
    );

    await rentals.archiveRentalUnit({ organizationId: organizationA.id, actorUserId: adminA.id, unitId: unitA.id, confirmation: 'ARCHIVE' });
    await rentals.archiveRentalLocation({ organizationId: organizationA.id, actorUserId: adminA.id, locationId: secondLocationA.id, confirmation: 'ARCHIVE' });
    await rentals.archiveRentalUnitType({ organizationId: organizationA.id, actorUserId: adminA.id, unitTypeId: unitTypeA.id, confirmation: 'ARCHIVE' });

    const events = await db.auditEvent.findMany({
      where: { organizationId: organizationA.id, resourceType: { startsWith: 'rental-' } },
    });
    assert.ok(events.some((event) => event.action === 'inventory.rental-location.created'));
    assert.ok(events.some((event) => event.action === 'inventory.rental-unit-type.created'));
    assert.ok(events.some((event) => event.action === 'inventory.rental-unit.created'));
    assert.ok(events.some((event) => event.action === 'inventory.rental-unit.location-assigned'));
    assert.ok(events.some((event) => event.action === 'inventory.rental-location.archived'));
    assert.ok(events.some((event) => event.action === 'inventory.rental-availability-block.created' && event.resourceId === block.id));
    assert.ok(events.some((event) => event.action === 'inventory.rental-rate-period.created' && event.resourceId === rate.id));
  } finally {
    await db.auditEvent.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.rentalAvailabilityBlock.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.rentalRatePeriod.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.rentalUnit.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.rentalLocation.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.rentalUnitType.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.organizationMembership.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.organization.deleteMany({ where: { id: { in: [organizationA.id, organizationB.id] } } });
    await db.user.deleteMany({ where: { id: { in: [adminA.id, staffUserA.id, adminB.id] } } });
  }
});
