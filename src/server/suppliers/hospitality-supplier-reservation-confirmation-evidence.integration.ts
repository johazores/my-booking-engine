import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) {
  throw new Error('Supplier confirmation evidence integration tests must run through npm run test:database with TEST_DATABASE_URL.');
}

test('supplier confirmation recovery evidence stays ambiguous until provider truth is established', async () => {
  const [{ db }, reservations] = await Promise.all([
    import('../database.ts'),
    import('./hospitality-supplier-reservation-service.ts'),
  ]);

  const runId = crypto.randomUUID();
  const admin = await db.user.create({
    data: { email: `supplier-confirmation-${runId}@example.test`, status: 'ACTIVE' },
  });
  const organization = await db.organization.create({
    data: {
      name: 'Supplier Confirmation Evidence Tenant',
      slug: `supplier-confirmation-${runId}`.slice(0, 63),
      kind: 'TRAVEL_AGENCY',
      timezone: 'UTC',
      currency: 'USD',
    },
  });
  await db.organizationMembership.create({
    data: {
      organizationId: organization.id,
      userId: admin.id,
      status: 'ACTIVE',
      role: 'ADMIN',
    },
  });
  const integration = await db.integration.create({
    data: {
      organizationId: organization.id,
      providerCode: 'travelport-stays',
      displayName: 'Travelport Stays',
      status: 'ACTIVE',
      capabilities: ['reservation'],
      credentialVersion: 1,
    },
  });

  const selection = {
    providerCode: 'travelport-stays',
    supplierPropertyReference: 'CN-B6381',
    supplierOfferReference: 'offer-confirmation-evidence',
    offerFingerprint: 'a'.repeat(64),
    termsFingerprint: 'b'.repeat(64),
    reservationAuthorityFingerprint: 'c'.repeat(64),
    reservationPayloadFingerprint: 'd'.repeat(64),
    currency: 'USD',
    expectedTotalMinor: 42_500n,
    arrivalDateLocal: '2026-11-10',
    departureDateLocal: '2026-11-12',
    rooms: 1,
    adults: 2,
    childAges: [],
  } as const;

  try {
    const locatorless = await reservations.prepareHospitalitySupplierReservation({
      organizationId: organization.id,
      actorUserId: admin.id,
      integrationId: integration.id,
      idempotencyKey: `supplier:confirmation:locatorless:${runId}`,
      selection,
    });
    const locatorlessClaim = await reservations.claimHospitalitySupplierReservationSubmission({
      organizationId: organization.id,
      actorUserId: admin.id,
      reservationId: locatorless.id,
    });
    const locatorlessAmbiguous = await reservations.settleHospitalitySupplierReservationSubmission({
      organizationId: organization.id,
      actorUserId: admin.id,
      reservationId: locatorless.id,
      attemptId: locatorlessClaim.attempt.id,
      outcome: {
        status: 'AMBIGUOUS',
        failureCode: 'TRAVELPORT_SYNC_REQUIRED',
        supplierConfirmationReference: 'BOOKING-SUPPLIER-001',
        providerCorrelationId: 'supplier-confirmation-locatorless',
      },
    });
    assert.equal(locatorlessAmbiguous.status, 'AMBIGUOUS');
    assert.equal(locatorlessAmbiguous.providerReservationReference, null);
    assert.equal(locatorlessAmbiguous.supplierConfirmationReference, 'BOOKING-SUPPLIER-001');

    await assert.rejects(
      reservations.claimHospitalitySupplierReservationReconciliation({
        organizationId: organization.id,
        actorUserId: admin.id,
        reservationId: locatorless.id,
      }),
      /without a provider reservation reference/i,
    );
    await assert.rejects(
      reservations.claimHospitalitySupplierReservationSubmission({
        organizationId: organization.id,
        actorUserId: admin.id,
        reservationId: locatorless.id,
      }),
      /must be reconciled/i,
    );

    const knownLocator = await reservations.prepareHospitalitySupplierReservation({
      organizationId: organization.id,
      actorUserId: admin.id,
      integrationId: integration.id,
      idempotencyKey: `supplier:confirmation:known:${runId}`,
      selection: { ...selection, reservationPayloadFingerprint: 'e'.repeat(64) },
    });
    const knownLocatorClaim = await reservations.claimHospitalitySupplierReservationSubmission({
      organizationId: organization.id,
      actorUserId: admin.id,
      reservationId: knownLocator.id,
    });
    const knownLocatorAmbiguous = await reservations.settleHospitalitySupplierReservationSubmission({
      organizationId: organization.id,
      actorUserId: admin.id,
      reservationId: knownLocator.id,
      attemptId: knownLocatorClaim.attempt.id,
      outcome: {
        status: 'AMBIGUOUS',
        failureCode: 'TRAVELPORT_SYNC_REQUIRED',
        providerReservationReference: 'TVPT-PNR-001',
        supplierConfirmationReference: 'BOOKING-SUPPLIER-002',
      },
    });
    assert.equal(knownLocatorAmbiguous.supplierConfirmationReference, 'BOOKING-SUPPLIER-002');

    const foundClaim = await reservations.claimHospitalitySupplierReservationReconciliation({
      organizationId: organization.id,
      actorUserId: admin.id,
      reservationId: knownLocator.id,
    });
    const found = await reservations.settleHospitalitySupplierReservationReconciliation({
      organizationId: organization.id,
      actorUserId: admin.id,
      reservationId: knownLocator.id,
      attemptId: foundClaim.attempt.id,
      outcome: {
        status: 'FOUND',
        providerReservationReference: 'TVPT-PNR-001',
      },
    });
    assert.equal(found.status, 'CONFIRMED');
    assert.equal(found.providerReservationReference, 'TVPT-PNR-001');
    assert.equal(found.supplierConfirmationReference, 'BOOKING-SUPPLIER-002');

    const notFoundOperation = await reservations.prepareHospitalitySupplierReservation({
      organizationId: organization.id,
      actorUserId: admin.id,
      integrationId: integration.id,
      idempotencyKey: `supplier:confirmation:not-found:${runId}`,
      selection: { ...selection, reservationPayloadFingerprint: 'f'.repeat(64) },
    });
    const notFoundSubmission = await reservations.claimHospitalitySupplierReservationSubmission({
      organizationId: organization.id,
      actorUserId: admin.id,
      reservationId: notFoundOperation.id,
    });
    await reservations.settleHospitalitySupplierReservationSubmission({
      organizationId: organization.id,
      actorUserId: admin.id,
      reservationId: notFoundOperation.id,
      attemptId: notFoundSubmission.attempt.id,
      outcome: {
        status: 'AMBIGUOUS',
        failureCode: 'TIMEOUT',
        providerReservationReference: 'TVPT-PNR-002',
        supplierConfirmationReference: 'BOOKING-SUPPLIER-003',
      },
    });
    const notFoundClaim = await reservations.claimHospitalitySupplierReservationReconciliation({
      organizationId: organization.id,
      actorUserId: admin.id,
      reservationId: notFoundOperation.id,
    });
    const retryable = await reservations.settleHospitalitySupplierReservationReconciliation({
      organizationId: organization.id,
      actorUserId: admin.id,
      reservationId: notFoundOperation.id,
      attemptId: notFoundClaim.attempt.id,
      outcome: {
        status: 'NOT_FOUND',
        providerReservationReference: 'TVPT-PNR-002',
      },
    });
    assert.equal(retryable.status, 'PREPARED');
    assert.equal(retryable.providerReservationReference, null);
    assert.equal(retryable.supplierConfirmationReference, null);
  } finally {
    await db.hospitalitySupplierReservationAttempt.deleteMany({ where: { organizationId: organization.id } });
    await db.hospitalitySupplierReservationOperation.deleteMany({ where: { organizationId: organization.id } });
    await db.auditEvent.deleteMany({ where: { organizationId: organization.id } });
    await db.integration.deleteMany({ where: { organizationId: organization.id } });
    await db.organizationMembership.deleteMany({ where: { organizationId: organization.id } });
    await db.organization.delete({ where: { id: organization.id } });
    await db.user.delete({ where: { id: admin.id } });
  }
});
