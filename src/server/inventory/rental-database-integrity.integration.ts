import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) {
  throw new Error('Rental database integrity integration tests must run through npm run test:database with TEST_DATABASE_URL.');
}

test('rental database rejects orphan tenant roots and impossible archive state', async () => {
  const { db } = await import('../database.ts');
  const runId = crypto.randomUUID();
  const organization = await db.organization.create({
    data: {
      name: 'Rental Integrity Tenant',
      slug: `rental-integrity-${runId}`.slice(0, 63),
      kind: 'RENTAL_BUSINESS',
      timezone: 'Asia/Manila',
    },
  });

  try {
    const missingOrganizationId = crypto.randomUUID();

    await assert.rejects(
      db.rentalUnitType.create({
        data: {
          organizationId: missingOrganizationId,
          name: 'Orphan Unit Type',
          code: 'ORPHAN-TYPE',
          currency: 'PHP',
          defaultDailyRateMinor: 100,
        },
      }),
    );
    await assert.rejects(
      db.rentalLocation.create({
        data: {
          organizationId: missingOrganizationId,
          name: 'Orphan Depot',
          code: 'ORPHAN-DEPOT',
          addressLine1: '1 Missing Tenant Street',
          city: 'Makati',
          countryCode: 'PH',
          timeZone: 'Asia/Manila',
        },
      }),
    );

    const unitType = await db.rentalUnitType.create({
      data: {
        organizationId: organization.id,
        name: 'Integrity Bike',
        code: 'INTEGRITY-BIKE',
        currency: 'PHP',
        defaultDailyRateMinor: 100,
      },
    });
    const location = await db.rentalLocation.create({
      data: {
        organizationId: organization.id,
        name: 'Integrity Depot',
        code: 'INTEGRITY-DEPOT',
        addressLine1: '1 Integrity Street',
        city: 'Makati',
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });

    await assert.rejects(db.organization.delete({ where: { id: organization.id } }));
    await assert.rejects(
      db.rentalUnitType.update({
        where: { id: unitType.id },
        data: { status: 'ARCHIVED', archivedAt: null },
      }),
    );
    await assert.rejects(
      db.rentalLocation.update({
        where: { id: location.id },
        data: { status: 'ACTIVE', archivedAt: new Date() },
      }),
    );

    const unit = await db.rentalUnit.create({
      data: {
        organizationId: organization.id,
        unitTypeId: unitType.id,
        locationId: location.id,
        name: 'Integrity Bike 001',
        code: 'INTEGRITY-BIKE-001',
      },
    });
    await assert.rejects(
      db.rentalUnit.update({
        where: { id: unit.id },
        data: { status: 'ARCHIVED', archivedAt: null },
      }),
    );

    const [persistedUnitType, persistedLocation, persistedUnit] = await Promise.all([
      db.rentalUnitType.findUniqueOrThrow({ where: { id: unitType.id } }),
      db.rentalLocation.findUniqueOrThrow({ where: { id: location.id } }),
      db.rentalUnit.findUniqueOrThrow({ where: { id: unit.id } }),
    ]);
    assert.equal(persistedUnitType.status, 'ACTIVE');
    assert.equal(persistedUnitType.archivedAt, null);
    assert.equal(persistedLocation.status, 'ACTIVE');
    assert.equal(persistedLocation.archivedAt, null);
    assert.equal(persistedUnit.status, 'ACTIVE');
    assert.equal(persistedUnit.archivedAt, null);
  } finally {
    await db.rentalUnit.deleteMany({ where: { organizationId: organization.id } });
    await db.rentalLocation.deleteMany({ where: { organizationId: organization.id } });
    await db.rentalUnitType.deleteMany({ where: { organizationId: organization.id } });
    await db.organization.deleteMany({ where: { id: organization.id } });
  }
});
