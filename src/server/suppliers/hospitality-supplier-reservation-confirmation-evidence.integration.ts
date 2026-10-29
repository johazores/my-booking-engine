import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) {
  throw new Error('Supplier confirmation evidence integration tests must run through npm run test:database with TEST_DATABASE_URL.');
}

test('supplier confirmation recovery evidence stays ambiguous until provider truth is established', async (t) => {
  const [{ db }, reservations, recovery] = await Promise.all([
    import('../database.ts'),
    import('./hospitality-supplier-reservation-service.ts'),
    import('./hospitality-supplier-reservation-attempt-recovery-service.ts'),
  ]);

  const runId = crypto.randomUUID();
  // Keep supplier reservation fixtures in the future without local-time or DST drift.
  const todayUtc = new Date();
  const arrivalDate = new Date(Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), todayUtc.getUTCDate() + 90));
  const departureDate = new Date(Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), todayUtc.getUTCDate() + 92));
  const arrivalDateLocal = arrivalDate.toISOString().slice(0, 10);
  const departureDateLocal = departureDate.toISOString().slice(0, 10);
  const adminId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  let cleanupStarted = false;
  async function cleanupFixtures() {
    if (cleanupStarted) return;
    cleanupStarted = true;
    try {
      await db.hospitalitySupplierReservationAttempt.deleteMany({ where: { organizationId } });
      await db.hospitalitySupplierReservationOperation.deleteMany({ where: { organizationId } });
      await db.auditEvent.deleteMany({ where: { organizationId } });
      await db.integration.deleteMany({ where: { organizationId } });
      await db.organizationMembership.deleteMany({ where: { organizationId } });
      await db.organization.deleteMany({ where: { id: organizationId } });
      await db.user.deleteMany({ where: { id: adminId } });
    } finally {
      await db.$disconnect();
    }
  }
  // Register teardown before the first insert so partially created fixtures are removed.
  t.after(cleanupFixtures);
  const admin = await db.user.create({
    data: { id: adminId, email: `supplier-confirmation-${runId}@example.test`, status: 'ACTIVE' },
  });
  const organization = await db.organization.create({
    data: {
      id: organizationId,
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
    arrivalDateLocal: arrivalDateLocal,
    departureDateLocal: departureDateLocal,
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
    await recovery.markHospitalitySupplierReservationProviderRequestStarted({
      organizationId: organization.id,
      actorUserId: admin.id,
      reservationId: locatorless.id,
      attemptId: locatorlessClaim.attempt.id,
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
    await recovery.markHospitalitySupplierReservationProviderRequestStarted({
      organizationId: organization.id,
      actorUserId: admin.id,
      reservationId: knownLocator.id,
      attemptId: knownLocatorClaim.attempt.id,
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

    const incompleteFoundClaim = await reservations.claimHospitalitySupplierReservationReconciliation({
      organizationId: organization.id,
      actorUserId: admin.id,
      reservationId: knownLocator.id,
    });
    await recovery.markHospitalitySupplierReservationProviderRequestStarted({
      organizationId: organization.id,
      actorUserId: admin.id,
      reservationId: knownLocator.id,
      attemptId: incompleteFoundClaim.attempt.id,
    });
    const incompleteFound = await reservations.settleHospitalitySupplierReservationReconciliation({
      organizationId: organization.id,
      actorUserId: admin.id,
      reservationId: knownLocator.id,
      attemptId: incompleteFoundClaim.attempt.id,
      outcome: {
        status: 'FOUND',
        providerReservationReference: 'TVPT-PNR-001',
      },
    });
    assert.equal(incompleteFound.status, 'AMBIGUOUS');
    assert.equal(incompleteFound.providerReservationReference, 'TVPT-PNR-001');
    assert.equal(incompleteFound.supplierConfirmationReference, 'BOOKING-SUPPLIER-002');
    assert.equal(incompleteFound.lastFailureCode, 'SUPPLIER_CONFIRMATION_MISMATCH');

    const matchingFoundClaim = await reservations.claimHospitalitySupplierReservationReconciliation({
      organizationId: organization.id,
      actorUserId: admin.id,
      reservationId: knownLocator.id,
    });
    await recovery.markHospitalitySupplierReservationProviderRequestStarted({
      organizationId: organization.id,
      actorUserId: admin.id,
      reservationId: knownLocator.id,
      attemptId: matchingFoundClaim.attempt.id,
    });
    const found = await reservations.settleHospitalitySupplierReservationReconciliation({
      organizationId: organization.id,
      actorUserId: admin.id,
      reservationId: knownLocator.id,
      attemptId: matchingFoundClaim.attempt.id,
      outcome: {
        status: 'FOUND',
        providerReservationReference: 'TVPT-PNR-001',
        supplierConfirmationReference: 'BOOKING-SUPPLIER-002',
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
    await recovery.markHospitalitySupplierReservationProviderRequestStarted({
      organizationId: organization.id,
      actorUserId: admin.id,
      reservationId: notFoundOperation.id,
      attemptId: notFoundSubmission.attempt.id,
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
    await recovery.markHospitalitySupplierReservationProviderRequestStarted({
      organizationId: organization.id,
      actorUserId: admin.id,
      reservationId: notFoundOperation.id,
      attemptId: notFoundClaim.attempt.id,
    });
    const conflictingNotFound = await reservations.settleHospitalitySupplierReservationReconciliation({
      organizationId: organization.id,
      actorUserId: admin.id,
      reservationId: notFoundOperation.id,
      attemptId: notFoundClaim.attempt.id,
      outcome: {
        status: 'NOT_FOUND',
        providerReservationReference: 'TVPT-PNR-002',
      },
    });
    assert.equal(conflictingNotFound.status, 'AMBIGUOUS');
    assert.equal(conflictingNotFound.providerReservationReference, 'TVPT-PNR-002');
    assert.equal(conflictingNotFound.supplierConfirmationReference, 'BOOKING-SUPPLIER-003');
    assert.equal(conflictingNotFound.lastFailureCode, 'SUPPLIER_CONFIRMATION_MISMATCH');

    const safeNotFoundOperation = await reservations.prepareHospitalitySupplierReservation({
      organizationId: organization.id,
      actorUserId: admin.id,
      integrationId: integration.id,
      idempotencyKey: `supplier:confirmation:safe-not-found:${runId}`,
      selection: { ...selection, reservationPayloadFingerprint: '1'.repeat(64) },
    });
    const safeNotFoundSubmission = await reservations.claimHospitalitySupplierReservationSubmission({
      organizationId: organization.id,
      actorUserId: admin.id,
      reservationId: safeNotFoundOperation.id,
    });
    await recovery.markHospitalitySupplierReservationProviderRequestStarted({
      organizationId: organization.id,
      actorUserId: admin.id,
      reservationId: safeNotFoundOperation.id,
      attemptId: safeNotFoundSubmission.attempt.id,
    });
    await reservations.settleHospitalitySupplierReservationSubmission({
      organizationId: organization.id,
      actorUserId: admin.id,
      reservationId: safeNotFoundOperation.id,
      attemptId: safeNotFoundSubmission.attempt.id,
      outcome: {
        status: 'AMBIGUOUS',
        failureCode: 'TIMEOUT',
        providerReservationReference: 'TVPT-PNR-003',
      },
    });

    const contradictoryNotFoundClaim = await reservations.claimHospitalitySupplierReservationReconciliation({
      organizationId: organization.id,
      actorUserId: admin.id,
      reservationId: safeNotFoundOperation.id,
    });
    await recovery.markHospitalitySupplierReservationProviderRequestStarted({
      organizationId: organization.id,
      actorUserId: admin.id,
      reservationId: safeNotFoundOperation.id,
      attemptId: contradictoryNotFoundClaim.attempt.id,
    });
    const contradictoryNotFoundOutcome = {
      status: 'NOT_FOUND',
      providerReservationReference: 'TVPT-PNR-003',
      supplierConfirmationReference: 'BOOKING-SUPPLIER-004',
    } as unknown as Parameters<typeof reservations.settleHospitalitySupplierReservationReconciliation>[0]['outcome'];
    const contradictoryNotFound = await reservations.settleHospitalitySupplierReservationReconciliation({
      organizationId: organization.id,
      actorUserId: admin.id,
      reservationId: safeNotFoundOperation.id,
      attemptId: contradictoryNotFoundClaim.attempt.id,
      outcome: contradictoryNotFoundOutcome,
    });
    assert.equal(contradictoryNotFound.status, 'AMBIGUOUS');
    assert.equal(contradictoryNotFound.providerReservationReference, 'TVPT-PNR-003');
    assert.equal(contradictoryNotFound.supplierConfirmationReference, null);
    assert.equal(contradictoryNotFound.lastFailureCode, 'SUPPLIER_CONFIRMATION_MISMATCH');

    const safeNotFoundClaim = await reservations.claimHospitalitySupplierReservationReconciliation({
      organizationId: organization.id,
      actorUserId: admin.id,
      reservationId: safeNotFoundOperation.id,
    });
    await recovery.markHospitalitySupplierReservationProviderRequestStarted({
      organizationId: organization.id,
      actorUserId: admin.id,
      reservationId: safeNotFoundOperation.id,
      attemptId: safeNotFoundClaim.attempt.id,
    });
    const retryable = await reservations.settleHospitalitySupplierReservationReconciliation({
      organizationId: organization.id,
      actorUserId: admin.id,
      reservationId: safeNotFoundOperation.id,
      attemptId: safeNotFoundClaim.attempt.id,
      outcome: {
        status: 'NOT_FOUND',
        providerReservationReference: 'TVPT-PNR-003',
      },
    });
    assert.equal(retryable.status, 'PREPARED');
    assert.equal(retryable.providerReservationReference, null);
    assert.equal(retryable.supplierConfirmationReference, null);
  } finally {
    await cleanupFixtures();
  }
});
