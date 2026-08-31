import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) throw new Error('Hospitality add-on integration tests must run through npm run test:database with TEST_DATABASE_URL.');

test('hospitality add-ons enforce tenant scope, quantities, concurrency, dependencies, and quote fingerprints', async () => {
  const [{ db }, inventory, pricing, addons, organizations] = await Promise.all([
    import('../database.ts'),
    import('../inventory/hospitality-rate-plan-service.ts'),
    import('./hospitality-pricing-service.ts'),
    import('./hospitality-addon-service.ts'),
    import('../organizations/organization-management-service.ts'),
  ]);
  const runId = crypto.randomUUID();
  const admin = await db.user.create({ data: { email: `addon-admin-${runId}@example.test`, status: 'ACTIVE' } });
  const staff = await db.user.create({ data: { email: `addon-staff-${runId}@example.test`, status: 'ACTIVE' } });
  const outsider = await db.user.create({ data: { email: `addon-outsider-${runId}@example.test`, status: 'ACTIVE' } });
  const organization = await db.organization.create({ data: { name: 'Addon Tenant', slug: `addon-${runId}`.slice(0, 63), kind: 'HOTEL', currency: 'PHP' } });
  const otherOrganization = await db.organization.create({ data: { name: 'Other Addon Tenant', slug: `other-addon-${runId}`.slice(0, 63), kind: 'HOTEL', currency: 'PHP' } });
  await db.organizationMembership.createMany({ data: [
    { organizationId: organization.id, userId: admin.id, status: 'ACTIVE', role: 'ADMIN' },
    { organizationId: organization.id, userId: staff.id, status: 'ACTIVE', role: 'STAFF' },
    { organizationId: otherOrganization.id, userId: outsider.id, status: 'ACTIVE', role: 'ADMIN' },
  ] });
  const property = await db.hospitalityProperty.create({ data: { organizationId: organization.id, name: 'Addon Hotel', code: 'ADDON', timezone: 'Asia/Manila', countryCode: 'PH' } });
  const roomType = await db.hospitalityRoomType.create({ data: { organizationId: organization.id, propertyId: property.id, name: 'Suite', code: 'STE', maxOccupancy: 4 } });
  const ratePlan = await inventory.createHospitalityRatePlan({ organizationId: organization.id, actorUserId: admin.id, ratePlan: { propertyId: property.id, name: 'Flexible', code: 'FLEX', description: '' } });
  await inventory.assignHospitalityRatePlanToRoomType({ organizationId: organization.id, actorUserId: admin.id, propertyId: property.id, roomTypeId: roomType.id, ratePlanId: ratePlan.id });

  try {
    const baseRate = await pricing.createHospitalityBaseRate({ organizationId: organization.id, actorUserId: admin.id, baseRate: { propertyId: property.id, roomTypeId: roomType.id, ratePlanId: ratePlan.id, startDate: '2026-09-01', endDate: '2026-09-30', amount: '1000.00' } });
    await assert.rejects(addons.createHospitalityAddon({ organizationId: organization.id, actorUserId: staff.id, addon: { propertyId: property.id, roomTypeId: '', ratePlanId: '', name: 'Breakfast', code: 'BREAKFAST', description: '', pricingModel: 'PER_ROOM_NIGHT', amount: '100.00', maxQuantity: '1', startDate: '2026-09-01', endDate: '2026-09-30' } }), /permission/i);

    const transfer = await addons.createHospitalityAddon({ organizationId: organization.id, actorUserId: admin.id, addon: { propertyId: property.id, roomTypeId: '', ratePlanId: '', name: 'Airport transfer', code: 'TRANSFER', description: 'Private pickup', pricingModel: 'PER_BOOKING', amount: '500.00', maxQuantity: '1', startDate: '2026-09-01', endDate: '2026-09-30' } });
    const breakfast = await addons.createHospitalityAddon({ organizationId: organization.id, actorUserId: admin.id, addon: { propertyId: property.id, roomTypeId: roomType.id, ratePlanId: ratePlan.id, name: 'Breakfast', code: 'BREAKFAST', description: '', pricingModel: 'PER_ROOM_NIGHT', amount: '100.00', maxQuantity: '1', startDate: '2026-09-01', endDate: '2026-09-30' } });
    const bikes = await addons.createHospitalityAddon({ organizationId: organization.id, actorUserId: admin.id, addon: { propertyId: property.id, roomTypeId: '', ratePlanId: '', name: 'Bike rental', code: 'BIKE', description: '', pricingModel: 'PER_UNIT', amount: '200.00', maxQuantity: '4', startDate: '2026-09-01', endDate: '2026-09-30' } });

    const concurrent = await Promise.allSettled([
      addons.createHospitalityAddon({ organizationId: organization.id, actorUserId: admin.id, addon: { propertyId: property.id, roomTypeId: '', ratePlanId: '', name: 'Parking', code: 'PARKING', description: '', pricingModel: 'PER_ROOM', amount: '50.00', maxQuantity: '1', startDate: '2026-10-01', endDate: '2026-10-31' } }),
      addons.createHospitalityAddon({ organizationId: organization.id, actorUserId: admin.id, addon: { propertyId: property.id, roomTypeId: roomType.id, ratePlanId: ratePlan.id, name: 'Scoped parking', code: 'PARKING', description: '', pricingModel: 'PER_ROOM', amount: '40.00', maxQuantity: '1', startDate: '2026-10-10', endDate: '2026-10-20' } }),
    ]);
    assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(concurrent.filter((result) => result.status === 'rejected').length, 1);
    const parking = await db.hospitalityAddon.findFirstOrThrow({ where: { organizationId: organization.id, code: 'PARKING', status: 'ACTIVE' } });
    await addons.archiveHospitalityAddon({ organizationId: organization.id, actorUserId: admin.id, propertyId: property.id, addonId: parking.id });

    const otherTenantView = await addons.listHospitalityAddons({ organizationId: otherOrganization.id, actorUserId: outsider.id, propertyId: property.id, page: 1, pageSize: 20 });
    assert.equal(otherTenantView.total, 0);
    await assert.rejects(addons.createHospitalityAddon({ organizationId: otherOrganization.id, actorUserId: outsider.id, addon: { propertyId: property.id, roomTypeId: '', ratePlanId: '', name: 'Cross tenant', code: 'CROSS', description: '', pricingModel: 'PER_BOOKING', amount: '1.00', maxQuantity: '1', startDate: '2026-09-01', endDate: '2026-09-30' } }), /active property/i);

    const request = { propertyId: property.id, roomTypeId: roomType.id, ratePlanId: ratePlan.id, arrivalDate: '2026-09-10', departureDate: '2026-09-12', quantity: '2' };
    const withoutAddons = await pricing.quoteHospitalityPrice({ organizationId: organization.id, actorUserId: staff.id, request });
    assert.equal(withoutAddons.total.amountMinor, '400000');
    const quote = await pricing.quoteHospitalityPrice({ organizationId: organization.id, actorUserId: staff.id, request, addonSelections: [
      { addonId: bikes.id, quantity: 3 },
      { addonId: transfer.id, quantity: 1 },
      { addonId: breakfast.id, quantity: 1 },
    ] });
    assert.equal(quote.addonTotal.amountMinor, '150000');
    assert.equal(quote.total.amountMinor, '550000');
    assert.equal(quote.addons.length, 3);
    assert.notEqual(quote.fingerprint, withoutAddons.fingerprint);
    const unchanged = await pricing.revalidateHospitalityPrice({ organizationId: organization.id, actorUserId: staff.id, request, addonSelections: [
      { addonId: breakfast.id, quantity: 1 },
      { addonId: transfer.id, quantity: 1 },
      { addonId: bikes.id, quantity: 3 },
    ], expectedFingerprint: quote.fingerprint });
    assert.equal(unchanged.changed, false);
    await assert.rejects(pricing.quoteHospitalityPrice({ organizationId: organization.id, actorUserId: staff.id, request, addonSelections: [{ addonId: bikes.id, quantity: 5 }] }), /maximum/i);

    await pricing.archiveHospitalityBaseRate({ organizationId: organization.id, actorUserId: admin.id, propertyId: property.id, baseRateId: baseRate.id });
    await assert.rejects(inventory.removeHospitalityRatePlanFromRoomType({ organizationId: organization.id, actorUserId: admin.id, propertyId: property.id, roomTypeId: roomType.id, ratePlanId: ratePlan.id }), /add-ons/i);
    await assert.rejects(organizations.updateOrganizationSettings({ organizationId: organization.id, actorUserId: admin.id, name: organization.name, slug: organization.slug, kind: organization.kind, timezone: organization.timezone, currency: 'USD' }), /add-ons/i);

    await addons.archiveHospitalityAddon({ organizationId: organization.id, actorUserId: admin.id, propertyId: property.id, addonId: breakfast.id });
    await addons.archiveHospitalityAddon({ organizationId: organization.id, actorUserId: admin.id, propertyId: property.id, addonId: transfer.id });
    await addons.archiveHospitalityAddon({ organizationId: organization.id, actorUserId: admin.id, propertyId: property.id, addonId: bikes.id });
    const audit = await db.auditEvent.count({ where: { organizationId: organization.id, resourceType: 'hospitality-addon' } });
    assert.ok(audit >= 8);
  } finally {
    await db.auditEvent.deleteMany({ where: { organizationId: { in: [organization.id, otherOrganization.id] } } });
    await db.hospitalityAddon.deleteMany({ where: { organizationId: organization.id } });
    await db.hospitalityBaseRate.deleteMany({ where: { organizationId: organization.id } });
    await db.hospitalityRoomTypeRatePlan.deleteMany({ where: { organizationId: organization.id } });
    await db.hospitalityRatePlan.deleteMany({ where: { organizationId: organization.id } });
    await db.hospitalityRoomType.deleteMany({ where: { organizationId: organization.id } });
    await db.hospitalityProperty.deleteMany({ where: { organizationId: organization.id } });
    await db.organizationMembership.deleteMany({ where: { organizationId: { in: [organization.id, otherOrganization.id] } } });
    await db.organization.deleteMany({ where: { id: { in: [organization.id, otherOrganization.id] } } });
    await db.user.deleteMany({ where: { id: { in: [admin.id, staff.id, outsider.id] } } });
  }
});
