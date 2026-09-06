import assert from 'node:assert/strict';
import test from 'node:test';

import { HOSPITALITY_SUPPLIER_RESERVATION_ATTEMPT_LEASE_MS } from './hospitality-supplier-reservation-attempt-lease.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) {
  throw new Error('Supplier reservation attempt recovery integration tests must run through npm run test:database with TEST_DATABASE_URL.');
}

test('stale supplier reservation claims fail closed to ambiguity and remain tenant scoped', async () => {
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

    const staleStartedAt = new Date(Date.now() - HOSPITALITY_SUPPLIER_RESERVATION_ATTEMPT_LEASE_MS - 1_000);
    await db.hospitalitySupplierReservationAttempt.update({
      where: { id: submission.attempt.id },
      data: { startedAt: staleStartedAt },
    });
    const recoveredSubmission = await recovery.recoverStaleHospitalitySupplierReservationAttempt({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      reservationId: prepared.id,
    });
    assert.equal(recoveredSubmission.reservation.status, 'AMBIGUOUS');
    assert.equal(recoveredSubmission.reservation.lastFailureCode, 'EXECUTION_LEASE_EXPIRED');
    assert.equal(recoveredSubmission.attempt.status, 'AMBIGUOUS');

    const reconciliation = await reservations.claimHospitalitySupplierReservationReconciliation({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      reservationId: prepared.id,
    });
    await assert.rejects(
      recovery.recoverStaleHospitalitySupplierReservationAttempt({
        organizationId: tenantA.id,
        actorUserId: tenantAAdmin.id,
        reservationId: prepared.id,
      }),
      /within its execution lease/i,
    );

    await db.hospitalitySupplierReservationAttempt.update({
      where: { id: reconciliation.attempt.id },
      data: { startedAt: staleStartedAt },
    });
    const recoveredReconciliation = await recovery.recoverStaleHospitalitySupplierReservationAttempt({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      reservationId: prepared.id,
    });
    assert.equal(recoveredReconciliation.reservation.status, 'AMBIGUOUS');
    assert.equal(recoveredReconciliation.attempt.status, 'AMBIGUOUS');

    const reconciliationRetry = await reservations.claimHospitalitySupplierReservationReconciliation({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      reservationId: prepared.id,
    });
    const unresolved = await reservations.settleHospitalitySupplierReservationReconciliation({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      reservationId: prepared.id,
      attemptId: reconciliationRetry.attempt.id,
      outcome: {
        status: 'UNKNOWN',
        failureCode: 'PROVIDER_UNAVAILABLE',
      },
    });
    assert.equal(unresolved.status, 'AMBIGUOUS');

    const attempts = await db.hospitalitySupplierReservationAttempt.findMany({
      where: { organizationId: tenantA.id, reservationId: prepared.id },
      orderBy: { sequence: 'asc' },
    });
    assert.deepEqual(
      attempts.map((attempt) => [attempt.sequence, attempt.kind, attempt.status, attempt.normalizedFailureCode]),
      [
        [1, 'CREATE', 'AMBIGUOUS', 'EXECUTION_LEASE_EXPIRED'],
        [2, 'RECONCILE', 'AMBIGUOUS', 'EXECUTION_LEASE_EXPIRED'],
        [3, 'RECONCILE', 'AMBIGUOUS', 'PROVIDER_UNAVAILABLE'],
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
