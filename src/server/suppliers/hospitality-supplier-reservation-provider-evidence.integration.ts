import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) {
  throw new Error('Supplier provider-evidence integration tests must run through npm run test:database with TEST_DATABASE_URL.');
}

test('supplier attempt provider evidence is enforced by PostgreSQL even when services are bypassed', async () => {
  const { db } = await import('../database.ts');
  const runId = crypto.randomUUID();
  const organization = await db.organization.create({
    data: {
      name: 'Supplier Provider Evidence Tenant',
      slug: `supplier-provider-evidence-${runId}`.slice(0, 63),
      kind: 'TRAVEL_AGENCY',
      timezone: 'UTC',
      currency: 'USD',
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
  const reservation = await db.hospitalitySupplierReservationOperation.create({
    data: {
      organizationId: organization.id,
      integrationId: integration.id,
      integrationCredentialVersion: 1,
      idempotencyKey: `supplier:provider-evidence:${runId}`,
      requestFingerprint: 'a'.repeat(64),
      providerCode: 'travelport-stays',
      supplierPropertyReference: 'provider-evidence-property',
      supplierOfferReference: 'provider-evidence-offer',
      offerFingerprint: 'b'.repeat(64),
      termsFingerprint: 'c'.repeat(64),
      reservationPayloadFingerprint: 'd'.repeat(64),
      currency: 'USD',
      expectedTotalMinor: 12_500n,
      arrivalDate: new Date('2026-11-10T00:00:00.000Z'),
      departureDate: new Date('2026-11-12T00:00:00.000Z'),
      rooms: 1,
      adults: 2,
      childAges: [],
    },
  });

  async function createStartedAttempt(sequence, kind) {
    return db.hospitalitySupplierReservationAttempt.create({
      data: {
        organizationId: organization.id,
        reservationId: reservation.id,
        sequence,
        kind,
        status: 'STARTED',
      },
    });
  }

  async function expectRejectedTerminalState(attemptId, data) {
    await assert.rejects(
      db.hospitalitySupplierReservationAttempt.update({
        where: { id: attemptId, organizationId: organization.id },
        data,
      }),
    );
    const unchanged = await db.hospitalitySupplierReservationAttempt.findUniqueOrThrow({
      where: { id: attemptId, organizationId: organization.id },
    });
    assert.equal(unchanged.status, 'STARTED');
    assert.equal(unchanged.completedAt, null);
  }

  async function markProviderBoundary(attemptId) {
    await db.$executeRaw`
      UPDATE "hospitality_supplier_reservation_attempts"
      SET "providerRequestStartedAt" = "leaseStartedAt"
      WHERE "id" = ${attemptId}::uuid
        AND "organizationId" = ${organization.id}::uuid
    `;
    const marked = await db.hospitalitySupplierReservationAttempt.findUniqueOrThrow({
      where: { id: attemptId, organizationId: organization.id },
    });
    assert.ok(marked.providerRequestStartedAt);
  }

  try {
    const createProviderAttempt = await createStartedAttempt(1, 'CREATE');
    await expectRejectedTerminalState(createProviderAttempt.id, {
      status: 'SUCCEEDED',
      completedAt: new Date(),
    });
    await expectRejectedTerminalState(createProviderAttempt.id, {
      status: 'AMBIGUOUS',
      normalizedFailureCode: 'TIMEOUT',
      completedAt: new Date(),
    });
    await expectRejectedTerminalState(createProviderAttempt.id, {
      status: 'REVIEW_REQUIRED',
      normalizedFailureCode: 'SUPPLIER_PRICE_CHANGED',
      completedAt: new Date(),
    });
    await markProviderBoundary(createProviderAttempt.id);
    const reviewed = await db.hospitalitySupplierReservationAttempt.update({
      where: { id: createProviderAttempt.id, organizationId: organization.id },
      data: {
        status: 'REVIEW_REQUIRED',
        normalizedFailureCode: 'SUPPLIER_PRICE_CHANGED',
        completedAt: new Date(),
      },
    });
    assert.equal(reviewed.status, 'REVIEW_REQUIRED');

    const reconcileAttempt = await createStartedAttempt(2, 'RECONCILE');
    await expectRejectedTerminalState(reconcileAttempt.id, {
      status: 'SUCCEEDED',
      completedAt: new Date(),
    });
    await expectRejectedTerminalState(reconcileAttempt.id, {
      status: 'NOT_FOUND',
      completedAt: new Date(),
    });
    await markProviderBoundary(reconcileAttempt.id);
    await assert.rejects(
      db.hospitalitySupplierReservationAttempt.update({
        where: { id: reconcileAttempt.id, organizationId: organization.id },
        data: {
          status: 'REVIEW_REQUIRED',
          normalizedFailureCode: 'SUPPLIER_PRICE_CHANGED',
          completedAt: new Date(),
        },
      }),
    );
    const notFound = await db.hospitalitySupplierReservationAttempt.update({
      where: { id: reconcileAttempt.id, organizationId: organization.id },
      data: {
        status: 'NOT_FOUND',
        normalizedFailureCode: null,
        completedAt: new Date(),
      },
    });
    assert.equal(notFound.status, 'NOT_FOUND');

    const recoveryWriteAttempt = await createStartedAttempt(3, 'RECOVERY_WRITE');
    await expectRejectedTerminalState(recoveryWriteAttempt.id, {
      status: 'SUCCEEDED',
      completedAt: new Date(),
    });
    await expectRejectedTerminalState(recoveryWriteAttempt.id, {
      status: 'AMBIGUOUS',
      normalizedFailureCode: 'INVALID_RESPONSE',
      completedAt: new Date(),
    });
    await markProviderBoundary(recoveryWriteAttempt.id);
    await assert.rejects(
      db.hospitalitySupplierReservationAttempt.update({
        where: { id: recoveryWriteAttempt.id, organizationId: organization.id },
        data: {
          status: 'REVIEW_REQUIRED',
          normalizedFailureCode: 'SUPPLIER_PRICE_CHANGED',
          completedAt: new Date(),
        },
      }),
    );
    const ambiguousRecovery = await db.hospitalitySupplierReservationAttempt.update({
      where: { id: recoveryWriteAttempt.id, organizationId: organization.id },
      data: {
        status: 'AMBIGUOUS',
        normalizedFailureCode: 'INVALID_RESPONSE',
        completedAt: new Date(),
      },
    });
    assert.equal(ambiguousRecovery.status, 'AMBIGUOUS');

    const wrongReviewReason = await createStartedAttempt(4, 'CREATE');
    await markProviderBoundary(wrongReviewReason.id);
    await assert.rejects(
      db.hospitalitySupplierReservationAttempt.update({
        where: { id: wrongReviewReason.id, organizationId: organization.id },
        data: {
          status: 'REVIEW_REQUIRED',
          normalizedFailureCode: 'TIMEOUT',
          completedAt: new Date(),
        },
      }),
    );

    const preProviderCreateFailure = await createStartedAttempt(5, 'CREATE');
    const failedCreate = await db.hospitalitySupplierReservationAttempt.update({
      where: { id: preProviderCreateFailure.id, organizationId: organization.id },
      data: {
        status: 'FAILED',
        normalizedFailureCode: 'AUTHENTICATION_FAILED',
        completedAt: new Date(),
      },
    });
    assert.equal(failedCreate.providerRequestStartedAt, null);

    const preProviderReconcileUnknown = await createStartedAttempt(6, 'RECONCILE');
    const unknownReconcile = await db.hospitalitySupplierReservationAttempt.update({
      where: { id: preProviderReconcileUnknown.id, organizationId: organization.id },
      data: {
        status: 'AMBIGUOUS',
        normalizedFailureCode: 'PROVIDER_UNAVAILABLE',
        completedAt: new Date(),
      },
    });
    assert.equal(unknownReconcile.providerRequestStartedAt, null);

    const preProviderRecoveryFailure = await createStartedAttempt(7, 'RECOVERY_WRITE');
    const failedRecovery = await db.hospitalitySupplierReservationAttempt.update({
      where: { id: preProviderRecoveryFailure.id, organizationId: organization.id },
      data: {
        status: 'FAILED',
        normalizedFailureCode: 'AUTHENTICATION_FAILED',
        completedAt: new Date(),
      },
    });
    assert.equal(failedRecovery.providerRequestStartedAt, null);
  } finally {
    await db.hospitalitySupplierReservationAttempt.deleteMany({
      where: { organizationId: organization.id },
    });
    await db.hospitalitySupplierReservationOperation.deleteMany({
      where: { organizationId: organization.id },
    });
    await db.integration.deleteMany({
      where: { organizationId: organization.id },
    });
    await db.organization.delete({ where: { id: organization.id } });
  }
});
