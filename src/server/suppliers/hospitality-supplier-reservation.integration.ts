import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) {
  throw new Error('Supplier reservation integration tests must run through npm run test:database with TEST_DATABASE_URL.');
}

test('supplier reservation operations enforce tenant scope, exact idempotency, ambiguity recovery, and integration version safety', async () => {
  const [{ db }, reservations] = await Promise.all([
    import('../database.ts'),
    import('./hospitality-supplier-reservation-service.ts'),
  ]);

  const runId = crypto.randomUUID();
  const tenantAAdmin = await db.user.create({
    data: { email: `supplier-reservation-a-${runId}@example.test`, status: 'ACTIVE' },
  });
  const tenantBAdmin = await db.user.create({
    data: { email: `supplier-reservation-b-${runId}@example.test`, status: 'ACTIVE' },
  });
  const tenantA = await db.organization.create({
    data: {
      name: 'Supplier Reservation Tenant A',
      slug: `supplier-reservation-a-${runId}`.slice(0, 63),
      kind: 'TRAVEL_AGENCY',
      timezone: 'UTC',
      currency: 'USD',
    },
  });
  const tenantB = await db.organization.create({
    data: {
      name: 'Supplier Reservation Tenant B',
      slug: `supplier-reservation-b-${runId}`.slice(0, 63),
      kind: 'TRAVEL_AGENCY',
      timezone: 'UTC',
      currency: 'USD',
    },
  });
  await db.organizationMembership.createMany({
    data: [
      { organizationId: tenantA.id, userId: tenantAAdmin.id, status: 'ACTIVE', role: 'ADMIN' },
      { organizationId: tenantB.id, userId: tenantBAdmin.id, status: 'ACTIVE', role: 'ADMIN' },
    ],
  });
  const integrationA = await db.integration.create({
    data: {
      organizationId: tenantA.id,
      providerCode: 'travelport-stays',
      displayName: 'Travelport Stays',
      status: 'ACTIVE',
      capabilities: ['hotel-search', 'availability', 'pricing', 'reservation'],
      credentialVersion: 3,
    },
  });

  const selection = {
    providerCode: 'travelport-stays',
    supplierPropertyReference: 'test-property-reference',
    supplierOfferReference: 'test-offer-reference',
    offerFingerprint: 'a'.repeat(64),
    termsFingerprint: 'b'.repeat(64),
    reservationAuthorityFingerprint: 'd'.repeat(64),
    reservationPayloadFingerprint: 'c'.repeat(64),
    currency: 'USD',
    expectedTotalMinor: 125_500n,
    arrivalDateLocal: '2026-10-10',
    departureDateLocal: '2026-10-13',
    rooms: 1,
    adults: 2,
    childAges: [7],
  } as const;

  try {
    await assert.rejects(
      reservations.prepareHospitalitySupplierReservation({
        organizationId: tenantB.id,
        actorUserId: tenantBAdmin.id,
        integrationId: integrationA.id,
        idempotencyKey: 'supplier:test:cross-tenant',
        selection,
      }),
      /not available/i,
    );

    const prepared = await reservations.prepareHospitalitySupplierReservation({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      integrationId: integrationA.id,
      idempotencyKey: 'supplier:test:exact-retry',
      selection,
    });
    assert.equal(prepared.organizationId, tenantA.id);
    assert.equal(prepared.status, 'PREPARED');
    assert.equal(prepared.integrationCredentialVersion, 3);
    assert.equal(prepared.requestFingerprintVersion, 2);

    const exactRetry = await reservations.prepareHospitalitySupplierReservation({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      integrationId: integrationA.id,
      idempotencyKey: 'supplier:test:exact-retry',
      selection,
    });
    assert.equal(exactRetry.id, prepared.id);

    await assert.rejects(
      reservations.prepareHospitalitySupplierReservation({
        organizationId: tenantA.id,
        actorUserId: tenantAAdmin.id,
        integrationId: integrationA.id,
        idempotencyKey: 'supplier:test:exact-retry',
        selection: { ...selection, reservationAuthorityFingerprint: 'e'.repeat(64) },
      }),
      /different supplier reservation request/i,
    );

    const legacyUnbound = await reservations.prepareHospitalitySupplierReservation({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      integrationId: integrationA.id,
      idempotencyKey: 'supplier:test:legacy-unbound',
      selection: { ...selection, reservationPayloadFingerprint: 'e'.repeat(64) },
    });
    await db.hospitalitySupplierReservationOperation.update({
      where: { id: legacyUnbound.id },
      data: { requestFingerprintVersion: null },
    });
    await assert.rejects(
      reservations.claimHospitalitySupplierReservationSubmission({
        organizationId: tenantA.id,
        actorUserId: tenantAAdmin.id,
        reservationId: legacyUnbound.id,
      }),
      /authority must be reviewed again/i,
    );

    const firstClaim = await reservations.claimHospitalitySupplierReservationSubmission({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      reservationId: prepared.id,
    });
    assert.equal(firstClaim.reservation.status, 'SUBMITTING');
    assert.equal(firstClaim.attempt.kind, 'CREATE');
    assert.equal(firstClaim.attempt.sequence, 1);

    await assert.rejects(
      reservations.claimHospitalitySupplierReservationSubmission({
        organizationId: tenantA.id,
        actorUserId: tenantAAdmin.id,
        reservationId: prepared.id,
      }),
      /already in progress/i,
    );

    const ambiguous = await reservations.settleHospitalitySupplierReservationSubmission({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      reservationId: prepared.id,
      attemptId: firstClaim.attempt.id,
      outcome: {
        status: 'AMBIGUOUS',
        failureCode: 'TIMEOUT',
        providerCorrelationId: 'travelport-correlation-1',
      },
    });
    assert.equal(ambiguous.status, 'AMBIGUOUS');
    assert.equal(ambiguous.lastFailureCode, 'TIMEOUT');

    await assert.rejects(
      reservations.claimHospitalitySupplierReservationSubmission({
        organizationId: tenantA.id,
        actorUserId: tenantAAdmin.id,
        reservationId: prepared.id,
      }),
      /must be reconciled/i,
    );

    const reconciliation = await reservations.claimHospitalitySupplierReservationReconciliation({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      reservationId: prepared.id,
    });
    assert.equal(reconciliation.reservation.status, 'RECONCILING');
    assert.equal(reconciliation.attempt.kind, 'RECONCILE');

    const safeToRetry = await reservations.settleHospitalitySupplierReservationReconciliation({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      reservationId: prepared.id,
      attemptId: reconciliation.attempt.id,
      outcome: {
        status: 'NOT_FOUND',
        providerCorrelationId: 'travelport-reconcile-1',
      },
    });
    assert.equal(safeToRetry.status, 'PREPARED');

    const retryClaim = await reservations.claimHospitalitySupplierReservationSubmission({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      reservationId: prepared.id,
    });
    const confirmed = await reservations.settleHospitalitySupplierReservationSubmission({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      reservationId: prepared.id,
      attemptId: retryClaim.attempt.id,
      outcome: {
        status: 'CONFIRMED',
        providerReservationReference: 'TVPT-RESERVATION-001',
        providerCorrelationId: 'travelport-correlation-2',
      },
    });
    assert.equal(confirmed.status, 'CONFIRMED');
    assert.equal(confirmed.providerReservationReference, 'TVPT-RESERVATION-001');

    const attempts = await db.hospitalitySupplierReservationAttempt.findMany({
      where: { organizationId: tenantA.id, reservationId: prepared.id },
      orderBy: { sequence: 'asc' },
    });
    assert.deepEqual(
      attempts.map((attempt) => [attempt.sequence, attempt.kind, attempt.status]),
      [
        [1, 'CREATE', 'AMBIGUOUS'],
        [2, 'RECONCILE', 'NOT_FOUND'],
        [3, 'CREATE', 'SUCCEEDED'],
      ],
    );

    const versionBound = await reservations.prepareHospitalitySupplierReservation({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      integrationId: integrationA.id,
      idempotencyKey: 'supplier:test:credential-version',
      selection: { ...selection, reservationPayloadFingerprint: 'f'.repeat(64) },
    });
    await db.integration.update({
      where: { id: integrationA.id },
      data: { credentialVersion: { increment: 1 } },
    });
    await assert.rejects(
      reservations.claimHospitalitySupplierReservationSubmission({
        organizationId: tenantA.id,
        actorUserId: tenantAAdmin.id,
        reservationId: versionBound.id,
      }),
      /integration changed/i,
    );
    assert.equal(
      (await db.hospitalitySupplierReservationOperation.findUniqueOrThrow({ where: { id: versionBound.id } })).status,
      'PREPARED',
    );
  } finally {
    await db.hospitalitySupplierReservationAttempt.deleteMany({
      where: { organizationId: { in: [tenantA.id, tenantB.id] } },
    });
    await db.hospitalitySupplierReservationOperation.deleteMany({
      where: { organizationId: { in: [tenantA.id, tenantB.id] } },
    });
    await db.auditEvent.deleteMany({
      where: { organizationId: { in: [tenantA.id, tenantB.id] } },
    });
    await db.integration.deleteMany({
      where: { organizationId: { in: [tenantA.id, tenantB.id] } },
    });
    await db.organizationMembership.deleteMany({
      where: { organizationId: { in: [tenantA.id, tenantB.id] } },
    });
    await db.organization.deleteMany({
      where: { id: { in: [tenantA.id, tenantB.id] } },
    });
    await db.user.deleteMany({
      where: { id: { in: [tenantAAdmin.id, tenantBAdmin.id] } },
    });
  }
});
