import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) {
  throw new Error('Invoice issuance integration tests must run through npm run test:database with TEST_DATABASE_URL.');
}

test('Australian tax-invoice issuance is tenant scoped, idempotent, sequence safe, and evidence bound', async () => {
  const [{ db }, issuerService, preparationService, issuanceService, pricingEvidence] = await Promise.all([
    import('../database.ts'),
    import('./invoice-issuer-service.ts'),
    import('./hospitality-invoice-preparation-service.ts'),
    import('./hospitality-invoice-issuance-service.ts'),
    import('../bookings/booking-pricing-evidence-domain.ts'),
  ]);

  const runId = crypto.randomUUID();
  const adminA = await db.user.create({ data: { email: `invoice-issue-admin-a-${runId}@example.test`, status: 'ACTIVE' } });
  const staffA = await db.user.create({ data: { email: `invoice-issue-staff-a-${runId}@example.test`, status: 'ACTIVE' } });
  const adminB = await db.user.create({ data: { email: `invoice-issue-admin-b-${runId}@example.test`, status: 'ACTIVE' } });
  const organizationA = await db.organization.create({ data: { name: 'Invoice Issue Tenant A', slug: `invoice-issue-a-${runId}`.slice(0, 63), kind: 'HOTEL', currency: 'AUD' } });
  const organizationB = await db.organization.create({ data: { name: 'Invoice Issue Tenant B', slug: `invoice-issue-b-${runId}`.slice(0, 63), kind: 'HOTEL', currency: 'AUD' } });
  await db.organizationMembership.createMany({ data: [
    { organizationId: organizationA.id, userId: adminA.id, status: 'ACTIVE', role: 'ADMIN' },
    { organizationId: organizationA.id, userId: staffA.id, status: 'ACTIVE', role: 'STAFF' },
    { organizationId: organizationB.id, userId: adminB.id, status: 'ACTIVE', role: 'ADMIN' },
  ] });

  try {
    const issuerInput = {
      legalName: 'SF Invoice Hotel Pty Ltd',
      addressLine1: '12 Example Street',
      city: 'Sydney',
      region: 'NSW',
      postalCode: '2000',
      countryCode: 'AU',
      contactEmail: 'billing@example.test',
      registrations: [
        { scheme: 'ABN', identifier: '51824753556', countryCode: 'AU' },
        { scheme: 'GST', identifier: '51824753556', countryCode: 'AU' },
      ],
    };
    const issuer1 = await issuerService.createInvoiceIssuerProfileVersion({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      ...issuerInput,
    });

    const customer = await db.customer.create({ data: {
      organizationId: organizationA.id,
      firstName: 'Tax',
      lastName: 'Guest',
      email: 'tax-guest@example.test',
    } });
    const property = await db.hospitalityProperty.create({ data: {
      organizationId: organizationA.id,
      name: 'Invoice Issue Hotel',
      code: 'IIH',
      timezone: 'Australia/Sydney',
      countryCode: 'AU',
    } });
    const roomType = await db.hospitalityRoomType.create({ data: {
      organizationId: organizationA.id,
      propertyId: property.id,
      name: 'Tax Room',
      code: 'TAXROOM',
      maxOccupancy: 2,
    } });
    const ratePlan = await db.hospitalityRatePlan.create({ data: {
      organizationId: organizationA.id,
      propertyId: property.id,
      name: 'Tax Flexible',
      code: 'TAXFLEX',
    } });
    const hold = await db.hospitalityAvailabilityHold.create({ data: {
      organizationId: organizationA.id,
      propertyId: property.id,
      roomTypeId: roomType.id,
      ratePlanId: ratePlan.id,
      idempotencyKey: `invoice-issue-hold-${runId}`,
      arrivalDate: new Date('2026-11-01T00:00:00.000Z'),
      departureDate: new Date('2026-11-02T00:00:00.000Z'),
      quantity: 1,
      status: 'CONSUMED',
      expiresAt: new Date('2026-11-01T01:00:00.000Z'),
      endedAt: new Date('2026-11-01T00:01:00.000Z'),
    } });
    const fingerprint = 'a'.repeat(64);
    const booking = await db.hospitalityBooking.create({ data: {
      organizationId: organizationA.id,
      propertyId: property.id,
      roomTypeId: roomType.id,
      ratePlanId: ratePlan.id,
      customerId: customer.id,
      holdId: hold.id,
      idempotencyKey: `invoice-issue-booking-${runId}`,
      status: 'CONFIRMED',
      paymentStatus: 'UNPAID',
      arrivalDate: new Date('2026-11-01T00:00:00.000Z'),
      departureDate: new Date('2026-11-02T00:00:00.000Z'),
      quantity: 1,
      currency: 'AUD',
      accommodationSubtotalMinor: 10000n,
      taxTotalMinor: 1000n,
      feeTotalMinor: 0n,
      addonTotalMinor: 0n,
      totalMinor: 11000n,
      pricingFingerprint: fingerprint,
      addonSelections: [],
      confirmedAt: new Date('2026-11-01T00:01:00.000Z'),
    } });

    const breakdown = pricingEvidence.createHospitalityBookingPricingEvidenceBreakdown({
      propertyId: property.id,
      roomTypeId: roomType.id,
      ratePlanId: ratePlan.id,
      arrivalDate: '2026-11-01',
      departureDate: '2026-11-02',
      quantity: 1,
      currency: 'AUD',
      nightly: [{ date: '2026-11-01', amountMinor: '10000' }],
      charges: [{
        id: crypto.randomUUID(),
        code: 'GST',
        name: 'Goods and services tax',
        kind: 'TAX',
        calculation: 'FIXED_PER_BOOKING',
        amountMinor: '1000',
      }],
      addons: [],
      accommodationSubtotalMinor: '10000',
      taxTotalMinor: '1000',
      feeTotalMinor: '0',
      addonTotalMinor: '0',
      totalMinor: '11000',
      fingerprint,
    });
    const evidence = await db.hospitalityBookingPricingEvidence.create({ data: {
      organizationId: organizationA.id,
      bookingId: booking.id,
      evidenceKey: `invoice-issue-evidence-${runId}`,
      source: 'BOOKING_CONFIRMATION',
      bookingVersion: booking.updatedAt,
      propertyId: property.id,
      roomTypeId: roomType.id,
      ratePlanId: ratePlan.id,
      arrivalDate: booking.arrivalDate,
      departureDate: booking.departureDate,
      quantity: booking.quantity,
      addonSelections: [],
      currency: booking.currency,
      accommodationSubtotalMinor: booking.accommodationSubtotalMinor,
      taxTotalMinor: booking.taxTotalMinor,
      feeTotalMinor: booking.feeTotalMinor,
      addonTotalMinor: booking.addonTotalMinor,
      totalMinor: booking.totalMinor,
      pricingFingerprint: booking.pricingFingerprint,
      pricingBreakdown: JSON.parse(JSON.stringify(breakdown)),
    } });

    const preparation1 = await preparationService.prepareHospitalityInvoice({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      bookingId: booking.id,
    });
    assert.equal(preparation1.issuerProfileId, issuer1.id);
    assert.equal(preparation1.pricingEvidenceId, evidence.id);

    await assert.rejects(
      issuanceService.issueHospitalityAustralianTaxInvoice({
        organizationId: organizationA.id,
        actorUserId: staffA.id,
        bookingId: booking.id,
        preparationId: preparation1.id,
      }),
      /permission/i,
    );
    await assert.rejects(
      issuanceService.issueHospitalityAustralianTaxInvoice({
        organizationId: organizationB.id,
        actorUserId: adminB.id,
        bookingId: booking.id,
        preparationId: preparation1.id,
      }),
      /not available/i,
    );

    const [issued1a, issued1b] = await Promise.all([
      issuanceService.issueHospitalityAustralianTaxInvoice({
        organizationId: organizationA.id,
        actorUserId: adminA.id,
        bookingId: booking.id,
        preparationId: preparation1.id,
      }),
      issuanceService.issueHospitalityAustralianTaxInvoice({
        organizationId: organizationA.id,
        actorUserId: adminA.id,
        bookingId: booking.id,
        preparationId: preparation1.id,
      }),
    ]);
    assert.equal(issued1a.id, issued1b.id);
    assert.equal(issued1a.documentNumber, 'AU-TAX-00000001');
    assert.equal(issued1a.sequenceValue, 1n);
    assert.equal(await db.hospitalityIssuedInvoice.count({ where: { organizationId: organizationA.id, preparationId: preparation1.id } }), 1);

    const issuer2 = await issuerService.createInvoiceIssuerProfileVersion({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      ...issuerInput,
      postalCode: '2001',
    });
    const preparation2 = await preparationService.prepareHospitalityInvoice({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      bookingId: booking.id,
    });
    assert.equal(preparation2.issuerProfileId, issuer2.id);

    await db.hospitalityBooking.update({
      where: { id: booking.id },
      data: { pricingFingerprint: 'f'.repeat(64) },
    });
    await assert.rejects(
      issuanceService.issueHospitalityAustralianTaxInvoice({
        organizationId: organizationA.id,
        actorUserId: adminA.id,
        bookingId: booking.id,
        preparationId: preparation2.id,
      }),
      /current accepted commercial state/i,
    );
    const sequenceAfterRejectedIssuance = await db.hospitalityInvoiceNumberSequence.findUnique({
      where: { organizationId_jurisdictionCode_documentType: {
        organizationId: organizationA.id,
        jurisdictionCode: 'AU',
        documentType: 'TAX_INVOICE',
      } },
    });
    assert.equal(sequenceAfterRejectedIssuance?.nextValue, 2n);
    assert.equal(await db.hospitalityIssuedInvoice.count({ where: { organizationId: organizationA.id, preparationId: preparation2.id } }), 0);

    await db.hospitalityBooking.update({
      where: { id: booking.id },
      data: { pricingFingerprint: fingerprint },
    });
    const issued2 = await issuanceService.issueHospitalityAustralianTaxInvoice({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      bookingId: booking.id,
      preparationId: preparation2.id,
    });
    assert.equal(issued2.documentNumber, 'AU-TAX-00000002');
    assert.equal(issued2.sequenceValue, 2n);
    assert.equal(issued2.totalMinor, 11000n);

    const audits = await db.auditEvent.findMany({
      where: {
        organizationId: organizationA.id,
        action: 'payment.tax-invoice.issued',
        resourceId: { in: [issued1a.id, issued2.id] },
      },
    });
    assert.equal(audits.length, 2);
  } finally {
    await db.hospitalityIssuedInvoice.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.hospitalityInvoiceNumberSequence.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.hospitalityInvoicePreparation.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.invoiceIssuerProfile.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.hospitalityBookingPricingEvidence.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.auditEvent.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.hospitalityBooking.deleteMany({ where: { organizationId: organizationA.id } });
    await db.hospitalityAvailabilityHold.deleteMany({ where: { organizationId: organizationA.id } });
    await db.hospitalityRatePlan.deleteMany({ where: { organizationId: organizationA.id } });
    await db.hospitalityRoomType.deleteMany({ where: { organizationId: organizationA.id } });
    await db.hospitalityProperty.deleteMany({ where: { organizationId: organizationA.id } });
    await db.customer.deleteMany({ where: { organizationId: organizationA.id } });
    await db.organizationMembership.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.organization.deleteMany({ where: { id: { in: [organizationA.id, organizationB.id] } } });
    await db.user.deleteMany({ where: { id: { in: [adminA.id, staffA.id, adminB.id] } } });
  }
});
