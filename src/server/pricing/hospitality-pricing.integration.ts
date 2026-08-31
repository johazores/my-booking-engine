import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) {
  throw new Error('Hospitality pricing integration tests must run through npm run test:database with TEST_DATABASE_URL.');
}

test('hospitality base pricing enforces scope, exact money, overlap, dependencies, concurrency, and revalidation', async () => {
  const [{ db }, pricing, ratePlans] = await Promise.all([
    import('../database.ts'),
    import('./hospitality-pricing-service.ts'),
    import('../inventory/hospitality-rate-plan-service.ts'),
  ]);
  const runId = crypto.randomUUID();
  const adminA = await db.user.create({ data: { email: `pricing-admin-a-${runId}@example.test`, status: 'ACTIVE' } });
  const staffA = await db.user.create({ data: { email: `pricing-staff-a-${runId}@example.test`, status: 'ACTIVE' } });
  const adminB = await db.user.create({ data: { email: `pricing-admin-b-${runId}@example.test`, status: 'ACTIVE' } });
  const organizationA = await db.organization.create({ data: { name: 'Pricing Tenant A', slug: `pricing-a-${runId}`.slice(0, 63), kind: 'HOTEL', currency: 'PHP' } });
  const organizationB = await db.organization.create({ data: { name: 'Pricing Tenant B', slug: `pricing-b-${runId}`.slice(0, 63), kind: 'HOTEL', currency: 'USD' } });
  await db.organizationMembership.createMany({ data: [
    { organizationId: organizationA.id, userId: adminA.id, status: 'ACTIVE', role: 'ADMIN' },
    { organizationId: organizationA.id, userId: staffA.id, status: 'ACTIVE', role: 'STAFF' },
    { organizationId: organizationB.id, userId: adminB.id, status: 'ACTIVE', role: 'ADMIN' },
  ] });

  try {
    const propertyA = await db.hospitalityProperty.create({ data: { organizationId: organizationA.id, name: 'Pricing Hotel', code: 'PRICE', timezone: 'Asia/Manila', countryCode: 'PH' } });
    const propertyB = await db.hospitalityProperty.create({ data: { organizationId: organizationB.id, name: 'Other Pricing Hotel', code: 'OTHER', timezone: 'UTC', countryCode: 'US' } });
    const roomTypeA = await db.hospitalityRoomType.create({ data: { organizationId: organizationA.id, propertyId: propertyA.id, name: 'Deluxe', code: 'DLX', maxOccupancy: 2 } });
    const roomTypeB = await db.hospitalityRoomType.create({ data: { organizationId: organizationB.id, propertyId: propertyB.id, name: 'Other', code: 'OTH', maxOccupancy: 2 } });
    const ratePlanA = await db.hospitalityRatePlan.create({ data: { organizationId: organizationA.id, propertyId: propertyA.id, name: 'Flexible', code: 'FLEX' } });
    const ratePlanB = await db.hospitalityRatePlan.create({ data: { organizationId: organizationB.id, propertyId: propertyB.id, name: 'Other Plan', code: 'OTHER' } });
    await db.hospitalityRoomTypeRatePlan.createMany({ data: [
      { organizationId: organizationA.id, propertyId: propertyA.id, roomTypeId: roomTypeA.id, ratePlanId: ratePlanA.id },
      { organizationId: organizationB.id, propertyId: propertyB.id, roomTypeId: roomTypeB.id, ratePlanId: ratePlanB.id },
    ] });

    const firstRate = await pricing.createHospitalityBaseRate({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      baseRate: { propertyId: propertyA.id, roomTypeId: roomTypeA.id, ratePlanId: ratePlanA.id, startDate: '2026-09-01', endDate: '2026-09-30', amount: '1500.25' },
    });
    assert.equal(firstRate.amountMinor, 150025n);
    assert.equal(firstRate.currency, 'PHP');

    await assert.rejects(pricing.createHospitalityBaseRate({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      baseRate: { propertyId: propertyA.id, roomTypeId: roomTypeA.id, ratePlanId: ratePlanA.id, startDate: '2026-09-15', endDate: '2026-10-01', amount: '1600.00' },
    }), /cannot overlap/i);

    await assert.rejects(ratePlans.removeHospitalityRatePlanFromRoomType({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      propertyId: propertyA.id,
      roomTypeId: roomTypeA.id,
      ratePlanId: ratePlanA.id,
    }), /base rates/i);

    await assert.rejects(pricing.createHospitalityBaseRate({
      organizationId: organizationA.id,
      actorUserId: staffA.id,
      baseRate: { propertyId: propertyA.id, roomTypeId: roomTypeA.id, ratePlanId: ratePlanA.id, startDate: '2026-10-01', endDate: '2026-10-31', amount: '1600.00' },
    }), /permission/i);

    const concurrentResults = await Promise.allSettled([
      pricing.createHospitalityBaseRate({
        organizationId: organizationA.id,
        actorUserId: adminA.id,
        baseRate: { propertyId: propertyA.id, roomTypeId: roomTypeA.id, ratePlanId: ratePlanA.id, startDate: '2026-10-01', endDate: '2026-10-10', amount: '1600.00' },
      }),
      pricing.createHospitalityBaseRate({
        organizationId: organizationA.id,
        actorUserId: adminA.id,
        baseRate: { propertyId: propertyA.id, roomTypeId: roomTypeA.id, ratePlanId: ratePlanA.id, startDate: '2026-10-05', endDate: '2026-10-15', amount: '1700.00' },
      }),
    ]);
    assert.equal(concurrentResults.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(concurrentResults.filter((result) => result.status === 'rejected').length, 1);

    const quote = await pricing.quoteHospitalityBasePrice({
      organizationId: organizationA.id,
      actorUserId: staffA.id,
      request: { propertyId: propertyA.id, roomTypeId: roomTypeA.id, ratePlanId: ratePlanA.id, arrivalDate: '2026-09-10', departureDate: '2026-09-12', quantity: 2 },
    });
    assert.equal(quote.currency, 'PHP');
    assert.equal(quote.nightly.length, 2);
    assert.equal(quote.accommodationSubtotal.amountMinor, '600100');

    await assert.rejects(pricing.quoteHospitalityBasePrice({
      organizationId: organizationB.id,
      actorUserId: adminA.id,
      request: { propertyId: propertyB.id, roomTypeId: roomTypeB.id, ratePlanId: ratePlanB.id, arrivalDate: '2026-09-10', departureDate: '2026-09-12', quantity: 1 },
    }), /permission/i);

    await pricing.archiveHospitalityBaseRate({ organizationId: organizationA.id, actorUserId: adminA.id, propertyId: propertyA.id, baseRateId: firstRate.id });
    await pricing.createHospitalityBaseRate({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      baseRate: { propertyId: propertyA.id, roomTypeId: roomTypeA.id, ratePlanId: ratePlanA.id, startDate: '2026-09-01', endDate: '2026-09-30', amount: '1750.25' },
    });
    const revalidated = await pricing.revalidateHospitalityBasePrice({
      organizationId: organizationA.id,
      actorUserId: staffA.id,
      request: { propertyId: propertyA.id, roomTypeId: roomTypeA.id, ratePlanId: ratePlanA.id, arrivalDate: '2026-09-10', departureDate: '2026-09-12', quantity: 2 },
      expectedFingerprint: quote.fingerprint,
    });
    assert.equal(revalidated.changed, true);
    assert.equal(revalidated.latest.accommodationSubtotal.amountMinor, '700100');

    const events = await db.auditEvent.findMany({ where: { organizationId: organizationA.id, resourceType: 'hospitality-base-rate' } });
    assert.ok(events.some((event) => event.action === 'pricing.base-rate.created'));
    assert.ok(events.some((event) => event.action === 'pricing.base-rate.archived'));
  } finally {
    await db.auditEvent.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.hospitalityBaseRate.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.hospitalityRoomTypeRatePlan.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.hospitalityRatePlan.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.hospitalityRoomType.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.hospitalityProperty.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.organizationMembership.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.organization.deleteMany({ where: { id: { in: [organizationA.id, organizationB.id] } } });
    await db.user.deleteMany({ where: { id: { in: [adminA.id, staffA.id, adminB.id] } } });
  }
});
