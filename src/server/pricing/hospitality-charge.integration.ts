import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) throw new Error('Hospitality charge integration tests must run through npm run test:database with TEST_DATABASE_URL.');

test('hospitality taxes and fees enforce tenant scope, concurrency, dependencies, and exact quote totals', async () => {
  const [{ db }, inventory, pricing, charges, organizations] = await Promise.all([
    import('../database.ts'),
    import('../inventory/hospitality-rate-plan-service.ts'),
    import('./hospitality-pricing-service.ts'),
    import('./hospitality-charge-service.ts'),
    import('../organizations/organization-management-service.ts'),
  ]);
  const runId = crypto.randomUUID();
  const admin = await db.user.create({ data: { email: `charge-admin-${runId}@example.test`, status: 'ACTIVE' } });
  const staff = await db.user.create({ data: { email: `charge-staff-${runId}@example.test`, status: 'ACTIVE' } });
  const outsider = await db.user.create({ data: { email: `charge-outsider-${runId}@example.test`, status: 'ACTIVE' } });
  const organization = await db.organization.create({ data: { name: 'Charge Tenant', slug: `charge-${runId}`.slice(0, 63), kind: 'HOTEL', currency: 'PHP' } });
  const otherOrganization = await db.organization.create({ data: { name: 'Other Charge Tenant', slug: `other-charge-${runId}`.slice(0, 63), kind: 'HOTEL', currency: 'PHP' } });
  await db.organizationMembership.createMany({ data: [
    { organizationId: organization.id, userId: admin.id, status: 'ACTIVE', role: 'ADMIN' },
    { organizationId: organization.id, userId: staff.id, status: 'ACTIVE', role: 'STAFF' },
    { organizationId: otherOrganization.id, userId: outsider.id, status: 'ACTIVE', role: 'ADMIN' },
  ] });
  const property = await db.hospitalityProperty.create({ data: { organizationId: organization.id, name: 'Charge Hotel', code: 'CHARGE', timezone: 'Asia/Manila', countryCode: 'PH' } });
  const roomType = await db.hospitalityRoomType.create({ data: { organizationId: organization.id, propertyId: property.id, name: 'Deluxe', code: 'DLX', maxOccupancy: 2 } });
  const ratePlan = await inventory.createHospitalityRatePlan({ organizationId: organization.id, actorUserId: admin.id, ratePlan: { propertyId: property.id, name: 'Flexible', code: 'FLEX', description: '' } });
  await inventory.assignHospitalityRatePlanToRoomType({ organizationId: organization.id, actorUserId: admin.id, propertyId: property.id, roomTypeId: roomType.id, ratePlanId: ratePlan.id });

  try {
    const baseRate = await pricing.createHospitalityBaseRate({ organizationId: organization.id, actorUserId: admin.id, baseRate: { propertyId: property.id, roomTypeId: roomType.id, ratePlanId: ratePlan.id, startDate: '2026-09-01', endDate: '2026-09-30', amount: '1000.00' } });
    await assert.rejects(charges.createHospitalityChargeRule({ organizationId: organization.id, actorUserId: staff.id, rule: { propertyId: property.id, roomTypeId: '', ratePlanId: '', name: 'VAT', code: 'VAT', kind: 'TAX', calculation: 'PERCENTAGE', value: '12', startDate: '2026-09-01', endDate: '2026-09-30' } }), /permission/i);

    const vat = await charges.createHospitalityChargeRule({ organizationId: organization.id, actorUserId: admin.id, rule: { propertyId: property.id, roomTypeId: '', ratePlanId: '', name: 'VAT', code: 'VAT', kind: 'TAX', calculation: 'PERCENTAGE', value: '12', startDate: '2026-09-01', endDate: '2026-09-30' } });
    const fee = await charges.createHospitalityChargeRule({ organizationId: organization.id, actorUserId: admin.id, rule: { propertyId: property.id, roomTypeId: roomType.id, ratePlanId: ratePlan.id, name: 'Resort fee', code: 'RESORT', kind: 'FEE', calculation: 'FIXED_PER_ROOM_NIGHT', value: '100.00', startDate: '2026-09-01', endDate: '2026-09-30' } });
    const bookingFee = await charges.createHospitalityChargeRule({ organizationId: organization.id, actorUserId: admin.id, rule: { propertyId: property.id, roomTypeId: '', ratePlanId: '', name: 'Booking fee', code: 'BOOKING', kind: 'FEE', calculation: 'FIXED_PER_BOOKING', value: '25.00', startDate: '2026-09-01', endDate: '2026-09-30' } });
    await assert.rejects(charges.createHospitalityChargeRule({ organizationId: organization.id, actorUserId: admin.id, rule: { propertyId: property.id, roomTypeId: roomType.id, ratePlanId: ratePlan.id, name: 'Duplicate VAT', code: 'VAT', kind: 'TAX', calculation: 'PERCENTAGE', value: '5', startDate: '2026-09-10', endDate: '2026-09-20' } }), /overlaps/i);

    const concurrent = await Promise.allSettled([
      charges.createHospitalityChargeRule({ organizationId: organization.id, actorUserId: admin.id, rule: { propertyId: property.id, roomTypeId: '', ratePlanId: '', name: 'City levy', code: 'CITY', kind: 'FEE', calculation: 'FIXED_PER_BOOKING', value: '50.00', startDate: '2026-10-01', endDate: '2026-10-31' } }),
      charges.createHospitalityChargeRule({ organizationId: organization.id, actorUserId: admin.id, rule: { propertyId: property.id, roomTypeId: roomType.id, ratePlanId: ratePlan.id, name: 'Scoped city levy', code: 'CITY', kind: 'FEE', calculation: 'FIXED_PER_BOOKING', value: '40.00', startDate: '2026-10-10', endDate: '2026-10-20' } }),
    ]);
    assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(concurrent.filter((result) => result.status === 'rejected').length, 1);
    const cityRule = await db.hospitalityChargeRule.findFirstOrThrow({ where: { organizationId: organization.id, propertyId: property.id, code: 'CITY', status: 'ACTIVE' } });
    await charges.archiveHospitalityChargeRule({ organizationId: organization.id, actorUserId: admin.id, propertyId: property.id, chargeRuleId: cityRule.id });

    const otherTenantView = await charges.listHospitalityChargeRules({ organizationId: otherOrganization.id, actorUserId: outsider.id, propertyId: property.id, page: 1, pageSize: 20 });
    assert.equal(otherTenantView.total, 0);
    await assert.rejects(charges.createHospitalityChargeRule({ organizationId: otherOrganization.id, actorUserId: outsider.id, rule: { propertyId: property.id, roomTypeId: '', ratePlanId: '', name: 'Cross tenant', code: 'CROSS', kind: 'FEE', calculation: 'FIXED_PER_BOOKING', value: '1.00', startDate: '2026-09-01', endDate: '2026-09-30' } }), /active property/i);

    const baseQuote = await pricing.quoteHospitalityBasePrice({ organizationId: organization.id, actorUserId: staff.id, request: { propertyId: property.id, roomTypeId: roomType.id, ratePlanId: ratePlan.id, arrivalDate: '2026-09-10', departureDate: '2026-09-12', quantity: '2' } });
    const unchangedBase = await pricing.revalidateHospitalityBasePrice({ organizationId: organization.id, actorUserId: staff.id, request: { propertyId: property.id, roomTypeId: roomType.id, ratePlanId: ratePlan.id, arrivalDate: '2026-09-10', departureDate: '2026-09-12', quantity: '2' }, expectedFingerprint: baseQuote.fingerprint });
    assert.equal(unchangedBase.changed, false);

    const quote = await pricing.quoteHospitalityPrice({ organizationId: organization.id, actorUserId: staff.id, request: { propertyId: property.id, roomTypeId: roomType.id, ratePlanId: ratePlan.id, arrivalDate: '2026-09-10', departureDate: '2026-09-12', quantity: '2' } });
    assert.equal(quote.accommodationSubtotal.amountMinor, '400000');
    assert.equal(quote.taxes.amountMinor, '48000');
    assert.equal(quote.fees.amountMinor, '42500');
    assert.equal(quote.total.amountMinor, '490500');
    assert.equal(quote.charges.length, 3);

    await charges.archiveHospitalityChargeRule({ organizationId: organization.id, actorUserId: admin.id, propertyId: property.id, chargeRuleId: vat.id });
    const revalidated = await pricing.revalidateHospitalityPrice({ organizationId: organization.id, actorUserId: staff.id, request: { propertyId: property.id, roomTypeId: roomType.id, ratePlanId: ratePlan.id, arrivalDate: '2026-09-10', departureDate: '2026-09-12', quantity: '2' }, expectedFingerprint: quote.fingerprint });
    assert.equal(revalidated.changed, true);
    assert.equal(revalidated.latest.total.amountMinor, '442500');

    await pricing.archiveHospitalityBaseRate({ organizationId: organization.id, actorUserId: admin.id, propertyId: property.id, baseRateId: baseRate.id });
    await assert.rejects(inventory.removeHospitalityRatePlanFromRoomType({ organizationId: organization.id, actorUserId: admin.id, propertyId: property.id, roomTypeId: roomType.id, ratePlanId: ratePlan.id }), /taxes and fees/i);
    await assert.rejects(organizations.updateOrganizationSettings({ organizationId: organization.id, actorUserId: admin.id, name: organization.name, slug: organization.slug, kind: organization.kind, timezone: organization.timezone, currency: 'USD' }), /fixed taxes and fees/i);

    await charges.archiveHospitalityChargeRule({ organizationId: organization.id, actorUserId: admin.id, propertyId: property.id, chargeRuleId: fee.id });
    await charges.archiveHospitalityChargeRule({ organizationId: organization.id, actorUserId: admin.id, propertyId: property.id, chargeRuleId: bookingFee.id });
    const audit = await db.auditEvent.count({ where: { organizationId: organization.id, resourceType: 'hospitality-charge-rule' } });
    assert.ok(audit >= 8);
  } finally {
    await db.auditEvent.deleteMany({ where: { organizationId: { in: [organization.id, otherOrganization.id] } } });
    await db.hospitalityChargeRule.deleteMany({ where: { organizationId: organization.id } });
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
