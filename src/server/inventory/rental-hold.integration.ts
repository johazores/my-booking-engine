import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) {
  throw new Error('Rental hold integration tests must run through npm run test:database with TEST_DATABASE_URL.');
}

test('rental holds enforce tenant scope, permissions, idempotency, pricing evidence, concurrency, and inventory protection', async () => {
  const [{ db }, rentals, holds, availability] = await Promise.all([
    import('../database.ts'),
    import('./rental-service.ts'),
    import('./rental-hold-service.ts'),
    import('./rental-availability-service.ts'),
  ]);

  const runId = crypto.randomUUID();
  const adminA = await db.user.create({ data: { email: `rental-hold-admin-a-${runId}@example.test`, status: 'ACTIVE' } });
  const staffA = await db.user.create({ data: { email: `rental-hold-staff-a-${runId}@example.test`, status: 'ACTIVE' } });
  const adminB = await db.user.create({ data: { email: `rental-hold-admin-b-${runId}@example.test`, status: 'ACTIVE' } });
  const organizationA = await db.organization.create({
    data: {
      name: 'Rental Hold Tenant A',
      slug: `rental-hold-a-${runId}`.slice(0, 63),
      kind: 'RENTAL_BUSINESS',
      timezone: 'Asia/Manila',
    },
  });
  const organizationB = await db.organization.create({
    data: {
      name: 'Rental Hold Tenant B',
      slug: `rental-hold-b-${runId}`.slice(0, 63),
      kind: 'RENTAL_BUSINESS',
      timezone: 'Asia/Manila',
    },
  });
  await db.organizationMembership.createMany({
    data: [
      { organizationId: organizationA.id, userId: adminA.id, status: 'ACTIVE', role: 'ADMIN' },
      { organizationId: organizationA.id, userId: staffA.id, status: 'ACTIVE', role: 'STAFF' },
      { organizationId: organizationB.id, userId: adminB.id, status: 'ACTIVE', role: 'ADMIN' },
    ],
  });

  try {
    const locationA = await rentals.createRentalLocation({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      location: {
        name: 'Makati Hold Depot',
        code: 'MAKATI-HOLD',
        addressLine1: '123 Ayala Avenue',
        city: 'Makati',
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    const locationA2 = await rentals.createRentalLocation({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      location: {
        name: 'Quezon City Hold Depot',
        code: 'QC-HOLD',
        addressLine1: '1 Commonwealth Avenue',
        city: 'Quezon City',
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    const unitType = await rentals.createRentalUnitType({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      unitType: {
        name: 'Hold Test Bike',
        code: 'HOLD-BIKE',
        description: '',
        currency: 'PHP',
        defaultDailyRateMinor: 125000,
      },
    });
    const unitA = await rentals.createRentalUnit({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      unit: {
        unitTypeId: unitType.id,
        locationCode: locationA.code,
        name: 'Hold Bike 001',
        code: 'HOLD-001',
        description: '',
      },
    });
    const unitB = await rentals.createRentalUnit({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      unit: {
        unitTypeId: unitType.id,
        locationCode: locationA.code,
        name: 'Hold Bike 002',
        code: 'HOLD-002',
        description: '',
      },
    });

    await assert.rejects(
      holds.createRentalAvailabilityHold({
        organizationId: organizationA.id,
        actorUserId: staffA.id,
        hold: {
          unitId: unitA.id,
          startsOn: '2026-10-10',
          endsOn: '2026-10-13',
          idempotencyKey: `staff-denied:${runId}`,
        },
      }),
      /permission/i,
    );

    await assert.rejects(
      holds.createRentalAvailabilityHold({
        organizationId: organizationB.id,
        actorUserId: adminB.id,
        hold: {
          unitId: unitA.id,
          startsOn: '2026-10-10',
          endsOn: '2026-10-13',
          idempotencyKey: `cross-tenant:${runId}`,
        },
      }),
      /not active/i,
    );

    const idempotencyKey = `rental-hold:${runId}`;
    const first = await holds.createRentalAvailabilityHold({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      hold: {
        unitId: unitA.id,
        startsOn: '2026-10-10',
        endsOn: '2026-10-13',
        idempotencyKey,
      },
    });
    assert.equal(first.quotedCurrency, 'PHP');
    assert.equal(first.quotedTotalMinor, 375000n);
    assert.match(first.pricingFingerprint ?? '', /^[0-9a-f]{64}$/);
    assert.ok(first.pricingSnapshot);
    assert.ok(first.pricingObservedAt);

    await assert.rejects(
      db.rentalAvailabilityHold.update({
        where: { id: first.id },
        data: { quotedTotalMinor: 999999n },
      }),
      /pricing evidence is immutable/i,
    );

    const retry = await holds.createRentalAvailabilityHold({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      hold: {
        unitId: unitA.id,
        startsOn: '2026-10-10',
        endsOn: '2026-10-13',
        idempotencyKey,
      },
    });
    assert.equal(retry.id, first.id);
    assert.equal(retry.pricingFingerprint, first.pricingFingerprint);

    await assert.rejects(
      holds.createRentalAvailabilityHold({
        organizationId: organizationA.id,
        actorUserId: adminA.id,
        hold: {
          unitId: unitA.id,
          startsOn: '2026-10-11',
          endsOn: '2026-10-14',
          idempotencyKey,
        },
      }),
      /idempotency key/i,
    );
    await assert.rejects(
      holds.createRentalAvailabilityHold({
        organizationId: organizationA.id,
        actorUserId: adminA.id,
        hold: {
          unitId: unitA.id,
          startsOn: '2026-10-10',
          endsOn: '2026-10-13',
          idempotencyKey,
          expiresInMinutes: 20,
        },
      }),
      /idempotency key/i,
    );

    const initialPricingReview = await holds.readRentalAvailabilityHoldPricingReview({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      holdId: first.id,
    });
    assert.equal(initialPricingReview.pricingState, 'CURRENT');
    assert.equal(initialPricingReview.original?.totalMinor, 375000n);
    assert.equal(initialPricingReview.current.totalMinor, 375000n);

    await assert.rejects(
      holds.readRentalAvailabilityHoldPricingReview({
        organizationId: organizationB.id,
        actorUserId: adminB.id,
        holdId: first.id,
      }),
      /not available/i,
    );

    await rentals.createRentalRatePeriod({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      rate: {
        unitTypeId: unitType.id,
        startsOn: '2026-10-10',
        endsOn: '2026-10-13',
        dailyRateMinor: 150000,
      },
    });

    const changedPricingReview = await holds.readRentalAvailabilityHoldPricingReview({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      holdId: first.id,
    });
    assert.equal(changedPricingReview.pricingState, 'CHANGED');
    assert.equal(changedPricingReview.original?.totalMinor, 375000n);
    assert.equal(changedPricingReview.current.totalMinor, 450000n);
    assert.notEqual(changedPricingReview.original?.fingerprint, changedPricingReview.current.fingerprint);

    const heldAvailability = await availability.searchRentalInventoryAvailability({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      search: {
        unitTypeCode: unitType.code,
        locationCode: locationA.code,
        startsOn: '2026-10-10',
        endsOn: '2026-10-13',
      },
    });
    assert.equal(heldAvailability.availability.total, 1);
    assert.deepEqual(heldAvailability.availability.items.map((unit) => unit.id), [unitB.id]);
    assert.equal(heldAvailability.pricing.totalMinor, 450000);
    assert.equal(heldAvailability.pricing.fingerprint, changedPricingReview.current.fingerprint);

    await assert.rejects(
      rentals.createRentalAvailabilityBlock({
        organizationId: organizationA.id,
        actorUserId: adminA.id,
        block: {
          unitId: unitA.id,
          startsOn: '2026-10-11',
          endsOn: '2026-10-12',
          reason: 'Must not overlap active hold',
        },
      }),
    );
    await assert.rejects(
      rentals.assignRentalUnitLocation({
        organizationId: organizationA.id,
        actorUserId: adminA.id,
        unitId: unitA.id,
        locationCode: locationA2.code,
      }),
    );
    await assert.rejects(
      rentals.archiveRentalUnit({
        organizationId: organizationA.id,
        actorUserId: adminA.id,
        unitId: unitA.id,
        confirmation: 'ARCHIVE',
      }),
    );

    const released = await holds.releaseRentalAvailabilityHold({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      holdId: first.id,
    });
    assert.equal(released.status, 'RELEASED');

    const releasedAvailability = await availability.searchRentalInventoryAvailability({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      search: {
        unitTypeCode: unitType.code,
        locationCode: locationA.code,
        startsOn: '2026-10-10',
        endsOn: '2026-10-13',
      },
    });
    assert.equal(releasedAvailability.availability.total, 2);

    const concurrent = await Promise.allSettled([
      holds.createRentalAvailabilityHold({
        organizationId: organizationA.id,
        actorUserId: adminA.id,
        hold: {
          unitId: unitA.id,
          startsOn: '2026-11-01',
          endsOn: '2026-11-04',
          idempotencyKey: `concurrent-a:${runId}`,
        },
      }),
      holds.createRentalAvailabilityHold({
        organizationId: organizationA.id,
        actorUserId: adminA.id,
        hold: {
          unitId: unitA.id,
          startsOn: '2026-11-02',
          endsOn: '2026-11-05',
          idempotencyKey: `concurrent-b:${runId}`,
        },
      }),
    ]);
    const fulfilled = concurrent.filter((result) => result.status === 'fulfilled');
    const rejected = concurrent.filter((result) => result.status === 'rejected');
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    const winningHold = fulfilled[0];
    assert.equal(winningHold?.status, 'fulfilled');
    if (winningHold?.status === 'fulfilled') {
      await holds.releaseRentalAvailabilityHold({
        organizationId: organizationA.id,
        actorUserId: adminA.id,
        holdId: winningHold.value.id,
      });
    }

    await rentals.assignRentalUnitLocation({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      unitId: unitA.id,
      locationCode: locationA2.code,
    });

    const events = await db.auditEvent.findMany({
      where: {
        organizationId: organizationA.id,
        resourceType: 'rental-availability-hold',
      },
    });
    assert.ok(events.some((event) => event.action === 'availability.rental-hold.created'));
    assert.ok(events.some((event) => event.action === 'availability.rental-hold.released'));
  } finally {
    await db.auditEvent.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.rentalAvailabilityHold.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.rentalAvailabilityBlock.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.rentalRatePeriod.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.rentalUnit.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.rentalLocation.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.rentalUnitType.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.organizationMembership.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.organization.deleteMany({ where: { id: { in: [organizationA.id, organizationB.id] } } });
    await db.user.deleteMany({ where: { id: { in: [adminA.id, staffA.id, adminB.id] } } });
  }
});
