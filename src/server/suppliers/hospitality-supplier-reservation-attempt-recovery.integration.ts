import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) {
  throw new Error('Supplier reservation attempt recovery integration tests must run through npm run test:database with TEST_DATABASE_URL.');
}

test('stale supplier reservation claims distinguish pre-provider recovery from provider ambiguity and remain tenant scoped', async () => {
  const [{ db }, reservations, recovery] = await Promise.all([
    import('../database.ts'),
    import('./hospitality-supplier-reservation-service.ts'),
    import('./hospitality-supplier-reservation-attempt-recovery-service.ts'),
  ]);

  const runId = crypto.randomUUID();
  const tenantAAdmin = await db.user.create({
    data: { email: `supplier-recovery-a-${runId}@example.test`, status: 'ACTIVE' },
  });
  const tenantBAdmin = await db.user.create({
    data: { email: `supplier-recovery-b-${runId}@example.test`, status: 'ACTIVE' },
  });
  const tenantA = await db.organization.create({
    data: {
      name: 'Supplier Recovery Tenant A',
      slug: `supplier-recovery-a-${runId}`.slice(0, 63),
      kind: 'TRAVEL_AGENCY',
      timezone: 'UTC',
      currency: 'USD',
    },
  });
  const tenantB = await db.organization.create({
    data: {
      name: 'Supplier Recovery Tenant B',
      slug: `supplier-recovery-b-${runId}`.slice(0, 63),
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
      credentialVersion: 1,
    },
  });

  const selection = {
    providerCode: 'travelport-stays',
    supplierPropertyReference: 'stale-test-property',
    supplierOfferReference: 'stale-test-offer',
    offerFingerprint: 'a'.repeat(64),
    termsFingerprint: 'b'.repeat(64),
    reservationAuthorityFingerprint: 'c'.repeat(64),
    reservationPayloadFingerprint: 'd'.repeat(64),
    currency: 'USD',
    expectedTotalMinor: 88_500n,
    arrivalDateLocal: '2026-11-10',
    departureDateLocal: '2026-11-12',
    rooms: 1,
    adults: 2,
    childAges: [],
  } as const;

  try {
    const prepared = await reservations.prepareHospitalitySupplierReservation({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      integrationId: integrationA.id,
      idempotencyKey: 'supplier:test:stale-attempt-recovery',
      selection,
    });
    const submission = await reservations.claimHospitalitySupplierReservationSubmission({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      reservationId: prepared.id,
    });
    assert.ok(submission.attempt.leaseStartedAt instanceof Date);
    assert.equal(submission.attempt.providerRequestStartedAt, null);

    await assert.rejects(
      recovery.recoverStaleHospitalitySupplierReservationAttempt({
        organizationId: tenantA.id,
        actorUserId: tenantAAdmin.id,
        reservationId: prepared.id,
      }),
      /within its execution lease/i,
    );
    await assert.rejects(
      recovery.recoverStaleHospitalitySupplierReservationAttempt({
        organizationId: tenantB.id,
        actorUserId: tenantBAdmin.id,
        reservationId: prepared.id,
      }),
      /not available in this organization/i,
    );

    await db.$executeRaw`
      UPDATE "hospitality_supplier_reservation_attempts"
      SET "startedAt" = clock_timestamp() - interval '1 day'
      WHERE "id" = ${submission.attempt.id}::uuid
    `;
    await assert.rejects(
      recovery.recoverStaleHospitalitySupplierReservationAttempt({
        organizationId: tenantA.id,
        actorUserId: tenantAAdmin.id,
        reservationId: prepared.id,
      }),
      /within its execution lease/i,
    );

    await db.$executeRaw`
      UPDATE "hospitality_supplier_reservation_attempts"
      SET "leaseStartedAt" = clock_timestamp() - interval '11 minutes'
      WHERE "id" = ${submission.attempt.id}::uuid
    `;
    const recoveredBeforeProviderRequest = await recovery.recoverStaleHospitalitySupplierReservationAttempt({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      reservationId: prepared.id,
    });
    assert.equal(recoveredBeforeProviderRequest.reservation.status, 'PREPARED');
    assert.equal(recoveredBeforeProviderRequest.reservation.lastFailureCode, 'EXECUTION_LEASE_EXPIRED_BEFORE_PROVIDER_REQUEST');
    assert.equal(recoveredBeforeProviderRequest.reservation.lastFailureRetryable, true);
    assert.equal(recoveredBeforeProviderRequest.reservation.providerReservationReference, null);
    assert.equal(recoveredBeforeProviderRequest.attempt.status, 'FAILED');

    const submissionRetry = await reservations.claimHospitalitySupplierReservationSubmission({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      reservationId: prepared.id,
    });
    await assert.rejects(
      recovery.markHospitalitySupplierReservationProviderRequestStarted({
        organizationId: tenantB.id,
        actorUserId: tenantBAdmin.id,
        reservationId: prepared.id,
        attemptId: submissionRetry.attempt.id,
      }),
      /not available in this organization/i,
    );
    const markedSubmission = await recovery.markHospitalitySupplierReservationProviderRequestStarted({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      reservationId: prepared.id,
      attemptId: submissionRetry.attempt.id,
    });
    assert.ok(markedSubmission.providerRequestStartedAt instanceof Date);
    assert.ok(markedSubmission.leaseStartedAt instanceof Date);
    assert.equal(markedSubmission.providerRequestStartedAt.getTime(), markedSubmission.leaseStartedAt.getTime());
    const replayedMarker = await recovery.markHospitalitySupplierReservationProviderRequestStarted({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      reservationId: prepared.id,
      attemptId: submissionRetry.attempt.id,
    });
    assert.equal(replayedMarker.providerRequestStartedAt?.getTime(), markedSubmission.providerRequestStartedAt.getTime());
    assert.equal(replayedMarker.leaseStartedAt?.getTime(), markedSubmission.leaseStartedAt.getTime());
    await assert.rejects(
      recovery.recoverStaleHospitalitySupplierReservationAttempt({
        organizationId: tenantA.id,
        actorUserId: tenantAAdmin.id,
        reservationId: prepared.id,
      }),
      /within its execution lease/i,
    );

    await db.$executeRaw`
      UPDATE "hospitality_supplier_reservation_attempts"
      SET "leaseStartedAt" = clock_timestamp() - interval '11 minutes'
      WHERE "id" = ${submissionRetry.attempt.id}::uuid
    `;
    const recoveredAfterProviderRequest = await recovery.recoverStaleHospitalitySupplierReservationAttempt({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      reservationId: prepared.id,
    });
    assert.equal(recoveredAfterProviderRequest.reservation.status, 'AMBIGUOUS');
    assert.equal(recoveredAfterProviderRequest.reservation.lastFailureCode, 'EXECUTION_LEASE_EXPIRED');
    assert.equal(recoveredAfterProviderRequest.reservation.providerReservationReference, null);
    assert.equal(recoveredAfterProviderRequest.attempt.status, 'AMBIGUOUS');
    await assert.rejects(
      reservations.claimHospitalitySupplierReservationReconciliation({
        organizationId: tenantA.id,
        actorUserId: tenantAAdmin.id,
        reservationId: prepared.id,
      }),
      /without a provider reservation reference/i,
    );

    const reconcilePrepared = await reservations.prepareHospitalitySupplierReservation({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      integrationId: integrationA.id,
      idempotencyKey: 'supplier:test:stale-reconcile-recovery',
      selection: { ...selection, reservationPayloadFingerprint: 'e'.repeat(64) },
    });
    const reconcileSubmission = await reservations.claimHospitalitySupplierReservationSubmission({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      reservationId: reconcilePrepared.id,
    });
    await recovery.markHospitalitySupplierReservationProviderRequestStarted({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      reservationId: reconcilePrepared.id,
      attemptId: reconcileSubmission.attempt.id,
    });
    const ambiguousWithLocator = await reservations.settleHospitalitySupplierReservationSubmission({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      reservationId: reconcilePrepared.id,
      attemptId: reconcileSubmission.attempt.id,
      outcome: {
        status: 'AMBIGUOUS',
        failureCode: 'TIMEOUT',
        providerReservationReference: 'TVPT-STALE-RECONCILE-001',
      },
    });
    assert.equal(ambiguousWithLocator.providerReservationReference, 'TVPT-STALE-RECONCILE-001');

    const reconciliation = await reservations.claimHospitalitySupplierReservationReconciliation({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      reservationId: reconcilePrepared.id,
    });
    assert.equal(reconciliation.attempt.providerRequestStartedAt, null);
    await db.$executeRaw`
      UPDATE "hospitality_supplier_reservation_attempts"
      SET "leaseStartedAt" = clock_timestamp() - interval '11 minutes'
      WHERE "id" = ${reconciliation.attempt.id}::uuid
    `;
    const recoveredReconciliationBeforeProviderRequest = await recovery.recoverStaleHospitalitySupplierReservationAttempt({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      reservationId: reconcilePrepared.id,
    });
    assert.equal(recoveredReconciliationBeforeProviderRequest.reservation.status, 'AMBIGUOUS');
    assert.equal(recoveredReconciliationBeforeProviderRequest.reservation.providerReservationReference, 'TVPT-STALE-RECONCILE-001');
    assert.equal(recoveredReconciliationBeforeProviderRequest.attempt.status, 'FAILED');
    assert.equal(recoveredReconciliationBeforeProviderRequest.attempt.normalizedFailureCode, 'EXECUTION_LEASE_EXPIRED_BEFORE_PROVIDER_REQUEST');

    const reconciliationRetry = await reservations.claimHospitalitySupplierReservationReconciliation({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      reservationId: reconcilePrepared.id,
    });
    const markedReconciliation = await recovery.markHospitalitySupplierReservationProviderRequestStarted({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      reservationId: reconcilePrepared.id,
      attemptId: reconciliationRetry.attempt.id,
    });
    assert.ok(markedReconciliation.providerRequestStartedAt instanceof Date);
    await assert.rejects(
      recovery.recoverStaleHospitalitySupplierReservationAttempt({
        organizationId: tenantA.id,
        actorUserId: tenantAAdmin.id,
        reservationId: reconcilePrepared.id,
      }),
      /within its execution lease/i,
    );
    await db.$executeRaw`
      UPDATE "hospitality_supplier_reservation_attempts"
      SET "leaseStartedAt" = clock_timestamp() - interval '11 minutes'
      WHERE "id" = ${reconciliationRetry.attempt.id}::uuid
    `;
    const recoveredReconciliationAfterProviderRequest = await recovery.recoverStaleHospitalitySupplierReservationAttempt({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      reservationId: reconcilePrepared.id,
    });
    assert.equal(recoveredReconciliationAfterProviderRequest.reservation.status, 'AMBIGUOUS');
    assert.equal(recoveredReconciliationAfterProviderRequest.reservation.providerReservationReference, 'TVPT-STALE-RECONCILE-001');
    assert.equal(recoveredReconciliationAfterProviderRequest.attempt.status, 'AMBIGUOUS');

    const reconciliationFinal = await reservations.claimHospitalitySupplierReservationReconciliation({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      reservationId: reconcilePrepared.id,
    });
    await recovery.markHospitalitySupplierReservationProviderRequestStarted({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      reservationId: reconcilePrepared.id,
      attemptId: reconciliationFinal.attempt.id,
    });
    const unresolved = await reservations.settleHospitalitySupplierReservationReconciliation({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      reservationId: reconcilePrepared.id,
      attemptId: reconciliationFinal.attempt.id,
      outcome: {
        status: 'UNKNOWN',
        failureCode: 'PROVIDER_UNAVAILABLE',
      },
    });
    assert.equal(unresolved.status, 'AMBIGUOUS');
    assert.equal(unresolved.providerReservationReference, 'TVPT-STALE-RECONCILE-001');

    const submissionAttempts = await db.hospitalitySupplierReservationAttempt.findMany({
      where: { organizationId: tenantA.id, reservationId: prepared.id },
      orderBy: { sequence: 'asc' },
    });
    assert.deepEqual(
      submissionAttempts.map((attempt) => [attempt.sequence, attempt.kind, attempt.status, attempt.normalizedFailureCode]),
      [
        [1, 'CREATE', 'FAILED', 'EXECUTION_LEASE_EXPIRED_BEFORE_PROVIDER_REQUEST'],
        [2, 'CREATE', 'AMBIGUOUS', 'EXECUTION_LEASE_EXPIRED'],
      ],
    );

    const reconciliationAttempts = await db.hospitalitySupplierReservationAttempt.findMany({
      where: { organizationId: tenantA.id, reservationId: reconcilePrepared.id },
      orderBy: { sequence: 'asc' },
    });
    assert.deepEqual(
      reconciliationAttempts.map((attempt) => [attempt.sequence, attempt.kind, attempt.status, attempt.normalizedFailureCode]),
      [
        [1, 'CREATE', 'AMBIGUOUS', 'TIMEOUT'],
        [2, 'RECONCILE', 'FAILED', 'EXECUTION_LEASE_EXPIRED_BEFORE_PROVIDER_REQUEST'],
        [3, 'RECONCILE', 'AMBIGUOUS', 'EXECUTION_LEASE_EXPIRED'],
        [4, 'RECONCILE', 'AMBIGUOUS', 'PROVIDER_UNAVAILABLE'],
      ],
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
    await db.organization.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
    await db.user.deleteMany({ where: { id: { in: [tenantAAdmin.id, tenantBAdmin.id] } } });
  }
});
