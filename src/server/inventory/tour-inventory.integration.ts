import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) {
  throw new Error('Tour inventory integration tests must run through npm run test:database with TEST_DATABASE_URL.');
}

test('tour inventory enforces tenant scope, permissions, schedule capacity, add-ons, lifecycle, and audit', async () => {
  const [{ db }, tours] = await Promise.all([
    import('../database.ts'),
    import('./tour-service.ts'),
  ]);

  const runId = crypto.randomUUID();
  const userIds = Array.from({ length: 3 }, () => crypto.randomUUID());
  const organizationIds = Array.from({ length: 2 }, () => crypto.randomUUID());

  try {
    const [{ now }] = await db.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 30)).toISOString().slice(0, 10);
    const start = `${day}T08:00:00+08:00`;
    const end = `${day}T12:00:00+08:00`;
    const conflictingEnd = `${day}T13:00:00+08:00`;
    const adminA = await db.user.create({ data: { id: userIds[0], email: `tour-admin-a-${runId}@example.test`, status: 'ACTIVE' } });
    const staffA = await db.user.create({ data: { id: userIds[1], email: `tour-staff-a-${runId}@example.test`, status: 'ACTIVE' } });
    const adminB = await db.user.create({ data: { id: userIds[2], email: `tour-admin-b-${runId}@example.test`, status: 'ACTIVE' } });
    const organizationA = await db.organization.create({ data: { id: organizationIds[0], name: 'Tour Tenant A', slug: `tour-a-${runId}`.slice(0, 63), kind: 'TOUR_OPERATOR', timezone: 'Asia/Manila' } });
    const organizationB = await db.organization.create({ data: { id: organizationIds[1], name: 'Tour Tenant B', slug: `tour-b-${runId}`.slice(0, 63), kind: 'TOUR_OPERATOR', timezone: 'Asia/Manila' } });
    await db.organizationMembership.createMany({ data: [
      { organizationId: organizationA.id, userId: adminA.id, status: 'ACTIVE', role: 'ADMIN' },
      { organizationId: organizationA.id, userId: staffA.id, status: 'ACTIVE', role: 'STAFF' },
      { organizationId: organizationB.id, userId: adminB.id, status: 'ACTIVE', role: 'ADMIN' },
    ] });

    const productA = await tours.createTourProduct({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      product: {
        kind: 'TOUR',
        name: 'Manila Heritage Walk',
        code: 'MNL-WALK',
        description: 'Guided heritage walking tour.',
        timezone: 'Asia/Manila',
        meetingPoint: 'Fort Santiago entrance',
      },
    });
    const productB = await tours.createTourProduct({
      organizationId: organizationB.id,
      actorUserId: adminB.id,
      product: {
        kind: 'PACKAGE',
        name: 'Other Tenant Package',
        code: 'OTHER-PKG',
        description: '',
        timezone: 'Asia/Manila',
        meetingPoint: '',
      },
    });

    await assert.rejects(
      tours.createTourProduct({
        organizationId: organizationA.id,
        actorUserId: staffA.id,
        product: { kind: 'TOUR', name: 'Denied', code: 'DENIED', description: '', timezone: 'UTC', meetingPoint: '' },
      }),
      /permission/i,
    );
    await assert.rejects(
      tours.createTourDeparture({
        organizationId: organizationA.id,
        actorUserId: adminA.id,
        tourProductId: productB.id,
        departure: { startsAt: start, endsAt: end, capacity: '12' },
      }),
      /not active in this organization/i,
    );

    const departure = await tours.createTourDeparture({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      tourProductId: productA.id,
      departure: { startsAt: start, endsAt: end, capacity: '12' },
    });
    const addon = await tours.createTourAddon({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      tourProductId: productA.id,
      addon: { name: 'Museum pass', code: 'MUSEUM', description: 'Optional museum entry.', maxQuantityPerBooking: '4' },
    });

    await assert.rejects(
      tours.createTourProduct({
        organizationId: organizationA.id,
        actorUserId: adminA.id,
        product: { kind: 'PACKAGE', name: 'Duplicate code', code: 'MNL-WALK', description: '', timezone: 'Asia/Manila', meetingPoint: '' },
      }),
      /code already exists/i,
    );
    await assert.rejects(
      tours.createTourDeparture({
        organizationId: organizationA.id,
        actorUserId: adminA.id,
        tourProductId: productA.id,
        departure: { startsAt: start, endsAt: conflictingEnd, capacity: '20' },
      }),
      /departure already exists/i,
    );
    await assert.rejects(
      tours.createTourAddon({
        organizationId: organizationA.id,
        actorUserId: adminA.id,
        tourProductId: productA.id,
        addon: { name: 'Duplicate museum pass', code: 'MUSEUM', description: '', maxQuantityPerBooking: '1' },
      }),
      /add-on with that code already exists/i,
    );

    const listed = await tours.listTourProducts({ organizationId: organizationA.id, actorUserId: staffA.id, page: 1, pageSize: 20 });
    assert.deepEqual(listed.products.map((product) => product.id), [productA.id]);
    const detail = await tours.readTourInventoryDetail({
      organizationId: organizationA.id,
      actorUserId: staffA.id,
      tourProductId: productA.id,
      departurePage: 1,
      addonPage: 1,
      pageSize: 20,
    });
    assert.equal(detail.departureResult.departures[0]?.capacity, 12);
    assert.equal(detail.addonResult.addons[0]?.code, 'MUSEUM');
    await assert.rejects(
      tours.readTourProduct({ organizationId: organizationB.id, actorUserId: adminB.id, tourProductId: productA.id }),
      /not available in this organization/i,
    );

    await assert.rejects(
      tours.archiveTourProduct({ organizationId: organizationA.id, actorUserId: adminA.id, tourProductId: productA.id, confirmation: 'ARCHIVE' }),
      /archive active departures and add-ons/i,
    );
    await tours.archiveTourDeparture({ organizationId: organizationA.id, actorUserId: adminA.id, tourProductId: productA.id, departureId: departure.id, confirmation: 'ARCHIVE' });
    await tours.archiveTourAddon({ organizationId: organizationA.id, actorUserId: adminA.id, tourProductId: productA.id, addonId: addon.id, confirmation: 'ARCHIVE' });
    await tours.archiveTourProduct({ organizationId: organizationA.id, actorUserId: adminA.id, tourProductId: productA.id, confirmation: 'ARCHIVE' });

    const archived = await db.tourProduct.findFirstOrThrow({ where: { id: productA.id, organizationId: organizationA.id } });
    assert.equal(archived.status, 'ARCHIVED');
    assert.ok(archived.archivedAt);

    const events = await db.auditEvent.findMany({ where: { organizationId: organizationA.id, resourceType: { startsWith: 'tour-' } } });
    assert.ok(events.some((event) => event.action === 'inventory.tour-product.created'));
    assert.ok(events.some((event) => event.action === 'inventory.tour-departure.created'));
    assert.ok(events.some((event) => event.action === 'inventory.tour-addon.created'));
    assert.ok(events.some((event) => event.action === 'inventory.tour-product.archived'));
  } finally {
    try {
      await db.auditEvent.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await db.tourAddon.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await db.tourDeparture.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await db.tourProduct.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await db.organizationMembership.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await db.organization.deleteMany({ where: { id: { in: organizationIds } } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
    } finally {
      await db.$disconnect();
    }
  }
});
