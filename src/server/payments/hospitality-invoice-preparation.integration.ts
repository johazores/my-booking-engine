import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) {
  throw new Error('Invoice foundation integration tests must run through npm run test:database with TEST_DATABASE_URL.');
}

test('invoice issuer versions and hospitality invoice preparation stay tenant scoped and immutable', async () => {
  const [{ db }, issuerService, preparationService, pricingEvidence, preparationDomain] = await Promise.all([
    import('../database.ts'),
    import('./invoice-issuer-service.ts'),
    import('./hospitality-invoice-preparation-service.ts'),
    import('../bookings/booking-pricing-evidence-domain.ts'),
    import('./hospitality-invoice-preparation-domain.ts'),
  ]);

  const runId = crypto.randomUUID();
  const adminA = await db.user.create({ data: { email: `invoice-admin-a-${runId}@example.test`, status: 'ACTIVE' } });
  const staffA = await db.user.create({ data: { email: `invoice-staff-a-${runId}@example.test`, status: 'ACTIVE' } });
  const adminB = await db.user.create({ data: { email: `invoice-admin-b-${runId}@example.test`, status: 'ACTIVE' } });
  const organizationA = await db.organization.create({ data: { name: 'Invoice Tenant A', slug: `invoice-a-${runId}`.slice(0, 63), kind: 'HOTEL', currency: 'USD' } });
  const organizationB = await db.organization.create({ data: { name: 'Invoice Tenant B', slug: `invoice-b-${runId}`.slice(0, 63), kind: 'HOTEL', currency: 'USD' } });
  await db.organizationMembership.createMany({ data: [
    { organizationId: organizationA.id, userId: adminA.id, status: 'ACTIVE', role: 'ADMIN' },
    { organizationId: organizationA.id, userId: staffA.id, status: 'ACTIVE', role: 'STAFF' },
    { organizationId: organizationB.id, userId: adminB.id, status: 'ACTIVE', role: 'ADMIN' },
  ] });

  let bookingId: string | null = null;
  try {
    const issuerInput = {
      legalName: 'Invoice Tenant A Pty Ltd',
      addressLine1: '12 Example Street',
      addressLine2: '',
      city: 'Sydney',
      region: 'NSW',
      postalCode: '2000',
      countryCode: 'AU',
      contactEmail: 'billing@example.test',
      registrations: [{ scheme: 'ABN', identifier: '12345678901', countryCode: 'AU' }],
    };

    await assert.rejects(
      issuerService.createInvoiceIssuerProfileVersion({ organizationId: organizationA.id, actorUserId: staffA.id, ...issuerInput }),
      /permission/i,
    );

    const issuerA1 = await issuerService.createInvoiceIssuerProfileVersion({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      ...issuerInput,
    });
    assert.equal(issuerA1.version, 1);
    const issuerA1Retry = await issuerService.createInvoiceIssuerProfileVersion({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      ...issuerInput,
    });
    assert.equal(issuerA1Retry.id, issuerA1.id);
    assert.equal(await db.invoiceIssuerProfile.count({ where: { organizationId: organizationA.id } }), 1);

    const issuerB = await issuerService.createInvoiceIssuerProfileVersion({
      organizationId: organizationB.id,
      actorUserId: adminB.id,
      legalName: 'Invoice Tenant B LLC',
      addressLine1: '99 Other Street',
      city: 'New York',
      region: 'NY',
      postalCode: '10001',
      countryCode: 'US',
      contactEmail: 'billing-b@example.test',
      registrations: [{ scheme: 'TIN', identifier: 'TENANT-B-TAX-ID', countryCode: 'US' }],
    });

    const customer = await db.customer.create({ data: { organizationId: organizationA.id, firstName: 'Invoice', lastName: 'Guest' } });
    const property = await db.hospitalityProperty.create({ data: { organizationId: organizationA.id, name: 'Invoice Hotel', code: 'INV', timezone: 'UTC', countryCode: 'AU' } });
    const roomType = await db.hospitalityRoomType.create({ data: { organizationId: organizationA.id, propertyId: property.id, name: 'Room', code: 'ROOM', maxOccupancy: 2 } });
    const ratePlan = await db.hospitalityRatePlan.create({ data: { organizationId: organizationA.id, propertyId: property.id, name: 'Flexible', code: 'FLEX' } });
    const hold = await db.hospitalityAvailabilityHold.create({ data: {
      organizationId: organizationA.id,
      propertyId: property.id,
      roomTypeId: roomType.id,
      ratePlanId: ratePlan.id,
      idempotencyKey: 'invoice-test-hold',
      arrivalDate: new Date('2026-10-01T00:00:00.000Z'),
      departureDate: new Date('2026-10-02T00:00:00.000Z'),
      quantity: 1,
      status: 'CONSUMED',
      expiresAt: new Date('2026-10-01T01:00:00.000Z'),
      endedAt: new Date('2026-10-01T00:01:00.000Z'),
    } });
    const fingerprint = 'a'.repeat(64);
    const booking = await db.hospitalityBooking.create({ data: {
      organizationId: organizationA.id,
      propertyId: property.id,
      roomTypeId: roomType.id,
      ratePlanId: ratePlan.id,
      customerId: customer.id,
      holdId: hold.id,
      idempotencyKey: 'invoice-test-booking',
      status: 'CONFIRMED',
      paymentStatus: 'UNPAID',
      arrivalDate: new Date('2026-10-01T00:00:00.000Z'),
      departureDate: new Date('2026-10-02T00:00:00.000Z'),
      quantity: 1,
      currency: 'USD',
      accommodationSubtotalMinor: 11000n,
      taxTotalMinor: 1000n,
      feeTotalMinor: 345n,
      addonTotalMinor: 0n,
      totalMinor: 12345n,
      pricingFingerprint: fingerprint,
      addonSelections: [],
      confirmedAt: new Date('2026-10-01T00:01:00.000Z'),
    } });
    bookingId = booking.id;

    const breakdown = pricingEvidence.createHospitalityBookingPricingEvidenceBreakdown({
      propertyId: property.id,
      roomTypeId: roomType.id,
      ratePlanId: ratePlan.id,
      arrivalDate: '2026-10-01',
      departureDate: '2026-10-02',
      quantity: 1,
      currency: 'USD',
      nightly: [{ date: '2026-10-01', amountMinor: '11000' }],
      charges: [
        { id: crypto.randomUUID(), code: 'tax', name: 'Tax', kind: 'TAX', calculation: 'FIXED_PER_BOOKING', amountMinor: '1000' },
        { id: crypto.randomUUID(), code: 'fee', name: 'Fee', kind: 'FEE', calculation: 'FIXED_PER_BOOKING', amountMinor: '345' },
      ],
      addons: [],
      accommodationSubtotalMinor: '11000',
      taxTotalMinor: '1000',
      feeTotalMinor: '345',
      addonTotalMinor: '0',
      totalMinor: '12345',
      fingerprint,
    });
    const evidence = await db.hospitalityBookingPricingEvidence.create({ data: {
      organizationId: organizationA.id,
      bookingId: booking.id,
      evidenceKey: 'invoice-test-pricing-evidence',
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

    await assert.rejects(
      preparationService.prepareHospitalityInvoice({ organizationId: organizationA.id, actorUserId: staffA.id, bookingId: booking.id }),
      /permission/i,
    );
    await assert.rejects(
      preparationService.prepareHospitalityInvoice({ organizationId: organizationB.id, actorUserId: adminB.id, bookingId: booking.id }),
      /not available/i,
    );

    const preparation1 = await preparationService.prepareHospitalityInvoice({ organizationId: organizationA.id, actorUserId: adminA.id, bookingId: booking.id });
    assert.equal(preparation1.issuerProfileId, issuerA1.id);
    assert.equal(preparation1.pricingEvidenceId, evidence.id);
    assert.equal(preparation1.totalMinor, booking.totalMinor);
    const preparation1Retry = await preparationService.prepareHospitalityInvoice({ organizationId: organizationA.id, actorUserId: adminA.id, bookingId: booking.id });
    assert.equal(preparation1Retry.id, preparation1.id);

    const issuerA2 = await issuerService.createInvoiceIssuerProfileVersion({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      ...issuerInput,
      postalCode: '2001',
    });
    assert.equal(issuerA2.version, 2);
    assert.notEqual(issuerA2.id, issuerA1.id);

    const preparation2 = await preparationService.prepareHospitalityInvoice({ organizationId: organizationA.id, actorUserId: adminA.id, bookingId: booking.id });
    assert.notEqual(preparation2.id, preparation1.id);
    assert.equal(preparation2.issuerProfileId, issuerA2.id);
    assert.equal(preparation2.pricingEvidenceId, evidence.id);
    assert.equal(await db.hospitalityInvoicePreparation.count({ where: { organizationId: organizationA.id, bookingId: booking.id } }), 2);

    const unsafeDirectSnapshot = preparationDomain.createHospitalityInvoicePreparationSnapshot({
      pricingEvidenceId: evidence.id,
      issuerProfileId: issuerB.id,
      currency: booking.currency,
      accommodationSubtotalMinor: booking.accommodationSubtotalMinor,
      taxTotalMinor: booking.taxTotalMinor,
      feeTotalMinor: booking.feeTotalMinor,
      addonTotalMinor: booking.addonTotalMinor,
      totalMinor: booking.totalMinor,
      pricingFingerprint: booking.pricingFingerprint,
      issuerFingerprint: issuerB.fingerprint,
    });
    await assert.rejects(
      db.hospitalityInvoicePreparation.create({ data: {
        organizationId: organizationB.id,
        bookingId: booking.id,
        pricingEvidenceId: evidence.id,
        issuerProfileId: issuerB.id,
        preparationKey: preparationDomain.hospitalityInvoicePreparationKey({ organizationId: organizationB.id, bookingId: booking.id, snapshot: unsafeDirectSnapshot }),
        currency: unsafeDirectSnapshot.currency,
        accommodationSubtotalMinor: BigInt(unsafeDirectSnapshot.accommodationSubtotalMinor),
        taxTotalMinor: BigInt(unsafeDirectSnapshot.taxTotalMinor),
        feeTotalMinor: BigInt(unsafeDirectSnapshot.feeTotalMinor),
        addonTotalMinor: BigInt(unsafeDirectSnapshot.addonTotalMinor),
        totalMinor: BigInt(unsafeDirectSnapshot.totalMinor),
        pricingFingerprint: unsafeDirectSnapshot.pricingFingerprint,
        issuerFingerprint: unsafeDirectSnapshot.issuerFingerprint,
        documentFingerprint: preparationDomain.hospitalityInvoicePreparationFingerprint(unsafeDirectSnapshot),
        preparationSnapshot: JSON.parse(JSON.stringify(unsafeDirectSnapshot)),
        createdByUserId: adminB.id,
      } }),
    );

    const issuerAudits = await db.auditEvent.findMany({ where: { organizationId: organizationA.id, action: 'organization.invoice-issuer-profile.created' } });
    assert.equal(issuerAudits.length, 2);
    assert.equal(JSON.stringify(issuerAudits.map((event) => event.afterData)).includes('12345678901'), false);
    const preparationAudits = await db.auditEvent.findMany({ where: { organizationId: organizationA.id, action: 'payment.invoice-preparation.created', resourceId: { in: [preparation1.id, preparation2.id] } } });
    assert.equal(preparationAudits.length, 2);
  } finally {
    await db.hospitalityInvoicePreparation.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.invoiceIssuerProfile.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.hospitalityBookingPricingEvidence.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.auditEvent.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    if (bookingId) await db.hospitalityBooking.deleteMany({ where: { id: bookingId } });
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
