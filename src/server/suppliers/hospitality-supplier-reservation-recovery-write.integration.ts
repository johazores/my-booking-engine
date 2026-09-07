import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) {
  throw new Error('Supplier recovery-write integration tests must run through npm run test:database with TEST_DATABASE_URL.');
}

test('supplier recovery writes preserve evidence and never replay after provider ambiguity', async () => {
  const [{ db }, reservations, recovery, recoveryWrite] = await Promise.all([
    import('../database.ts'),
    import('./hospitality-supplier-reservation-service.ts'),
    import('./hospitality-supplier-reservation-attempt-recovery-service.ts'),
    import('./hospitality-supplier-reservation-recovery-write-service.ts'),
  ]);
  const { recordHospitalitySupplierReservationProviderRecoveryEvidence } =
    await import('./hospitality-supplier-reservation-recovery-evidence-service.ts');

  const runId = crypto.randomUUID();
  const admin = await db.user.create({
    data: { email: `supplier-recovery-write-${runId}@example.test`, status: 'ACTIVE' },
  });
  const organization = await db.organization.create({
    data: {
      name: 'Supplier Recovery Write Tenant',
      slug: `supplier-recovery-write-${runId}`.slice(0, 63),
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
    supplierOfferReference: 'offer-recovery-write',
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

  async function prepareRecoverable(suffix: string, fingerprint: string, confirmation: string) {
    const prepared = await reservations.prepareHospitalitySupplierReservation({
      organizationId: organization.id,
      actorUserId: admin.id,
      integrationId: integration.id,
      idempotencyKey: `supplier:recovery-write:${suffix}:${runId}`,
      selection: { ...selection, reservationPayloadFingerprint: fingerprint },
    });
    const createClaim = await reservations.claimHospitalitySupplierReservationSubmission({
      organizationId: organization.id,
      actorUserId: admin.id,
      reservationId: prepared.id,
    });
    await recovery.markHospitalitySupplierReservationProviderRequestStarted({
      organizationId: organization.id,
      actorUserId: admin.id,
      reservationId: prepared.id,
      attemptId: createClaim.attempt.id,
    });
    await recordHospitalitySupplierReservationProviderRecoveryEvidence({
      organizationId: organization.id,
      actorUserId: admin.id,
      reservationId: prepared.id,
      attemptId: createClaim.attempt.id,
      supplierConfirmationReference: confirmation,
      providerRecoveryReference: 'travelport-stays-sync-v1:BKNG:BO',
    });
    const ambiguous = await reservations.settleHospitalitySupplierReservationSubmission({
      organizationId: organization.id,
      actorUserId: admin.id,
      reservationId: prepared.id,
      attemptId: createClaim.attempt.id,
      outcome: {
        status: 'AMBIGUOUS',
        failureCode: 'TRAVELPORT_SYNC_REQUIRED',
        supplierConfirmationReference: confirmation,
      },
    });
    assert.equal(ambiguous.providerRecoveryReference, 'travelport-stays-sync-v1:BKNG:BO');
    return ambiguous;
  }

  try {
    const retryableOperation = await prepareRecoverable('retryable', 'd'.repeat(64), 'BOOKING-SYNC-001');
    const firstRecovery = await recoveryWrite.claimHospitalitySupplierReservationRecoveryWrite({
      organizationId: organization.id,
      actorUserId: admin.id,
      reservationId: retryableOperation.id,
      reservationPayloadFingerprint: 'd'.repeat(64),
    });
    assert.equal(firstRecovery.reservation.status, 'SUBMITTING');
    assert.equal(firstRecovery.attempt.kind, 'RECOVERY_WRITE');

    const preProviderFailure = await recoveryWrite.settleHospitalitySupplierReservationRecoveryWrite({
      organizationId: organization.id,
      actorUserId: admin.id,
      reservationId: retryableOperation.id,
      attemptId: firstRecovery.attempt.id,
      outcome: {
        status: 'FAILED',
        failureCode: 'AUTHENTICATION_FAILED',
        retryable: true,
      },
    });
    assert.equal(preProviderFailure.status, 'AMBIGUOUS');
    assert.equal(preProviderFailure.lastFailureRetryable, true);
    assert.equal(preProviderFailure.providerRecoveryReference, 'travelport-stays-sync-v1:BKNG:BO');

    const secondRecovery = await recoveryWrite.claimHospitalitySupplierReservationRecoveryWrite({
      organizationId: organization.id,
      actorUserId: admin.id,
      reservationId: retryableOperation.id,
      reservationPayloadFingerprint: 'd'.repeat(64),
    });
    await recovery.markHospitalitySupplierReservationProviderRequestStarted({
      organizationId: organization.id,
      actorUserId: admin.id,
      reservationId: retryableOperation.id,
      attemptId: secondRecovery.attempt.id,
    });

    await assert.rejects(
      recoveryWrite.settleHospitalitySupplierReservationRecoveryWrite({
        organizationId: organization.id,
        actorUserId: admin.id,
        reservationId: retryableOperation.id,
        attemptId: secondRecovery.attempt.id,
        outcome: {
          status: 'FAILED',
          failureCode: 'TIMEOUT',
          retryable: true,
        },
      }),
      /provider-marked recovery write cannot be settled as retryable/i,
    );

    const ambiguousRecovery = await recoveryWrite.settleHospitalitySupplierReservationRecoveryWrite({
      organizationId: organization.id,
      actorUserId: admin.id,
      reservationId: retryableOperation.id,
      attemptId: secondRecovery.attempt.id,
      outcome: {
        status: 'AMBIGUOUS',
        failureCode: 'INVALID_RESPONSE',
      },
    });
    assert.equal(ambiguousRecovery.status, 'AMBIGUOUS');
    assert.equal(ambiguousRecovery.providerRecoveryReference, 'travelport-stays-sync-v1:BKNG:BO');

    await assert.rejects(
      recoveryWrite.claimHospitalitySupplierReservationRecoveryWrite({
        organizationId: organization.id,
        actorUserId: admin.id,
        reservationId: retryableOperation.id,
        reservationPayloadFingerprint: 'd'.repeat(64),
      }),
      /already crossed or may have crossed the provider boundary/i,
    );

    const successOperation = await prepareRecoverable('success', 'e'.repeat(64), 'BOOKING-SYNC-002');
    await assert.rejects(
      recoveryWrite.claimHospitalitySupplierReservationRecoveryWrite({
        organizationId: organization.id,
        actorUserId: admin.id,
        reservationId: successOperation.id,
        reservationPayloadFingerprint: 'f'.repeat(64),
      }),
      /traveler details changed/i,
    );

    const successClaim = await recoveryWrite.claimHospitalitySupplierReservationRecoveryWrite({
      organizationId: organization.id,
      actorUserId: admin.id,
      reservationId: successOperation.id,
      reservationPayloadFingerprint: 'e'.repeat(64),
    });
    await recovery.markHospitalitySupplierReservationProviderRequestStarted({
      organizationId: organization.id,
      actorUserId: admin.id,
      reservationId: successOperation.id,
      attemptId: successClaim.attempt.id,
    });

    await assert.rejects(
      recoveryWrite.settleHospitalitySupplierReservationRecoveryWrite({
        organizationId: organization.id,
        actorUserId: admin.id,
        reservationId: successOperation.id,
        attemptId: successClaim.attempt.id,
        outcome: {
          status: 'CONFIRMED',
          providerReservationReference: 'TVPT-SYNC-001',
          supplierConfirmationReference: 'DIFFERENT',
        },
      }),
      /different supplier confirmation/i,
    );

    const confirmed = await recoveryWrite.settleHospitalitySupplierReservationRecoveryWrite({
      organizationId: organization.id,
      actorUserId: admin.id,
      reservationId: successOperation.id,
      attemptId: successClaim.attempt.id,
      outcome: {
        status: 'CONFIRMED',
        providerReservationReference: 'TVPT-SYNC-001',
        supplierConfirmationReference: 'BOOKING-SYNC-002',
        providerCorrelationId: 'sync-correlation-001',
      },
    });
    assert.equal(confirmed.status, 'CONFIRMED');
    assert.equal(confirmed.providerReservationReference, 'TVPT-SYNC-001');
    assert.equal(confirmed.supplierConfirmationReference, 'BOOKING-SYNC-002');
    assert.equal(confirmed.providerRecoveryReference, null);
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