import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) {
  throw new Error('Supplier reservation reconciliation integration tests must run through npm run test:database with TEST_DATABASE_URL.');
}

test('supplier reconciliation preserves known locator authority and durable supplier confirmation evidence', async () => {
  const [{ db }, reservations, reconciliation] = await Promise.all([
    import('../database.ts'),
    import('./hospitality-supplier-reservation-service.ts'),
    import('./hospitality-supplier-reservation-reconciliation-service.ts'),
  ]);

  const runId = crypto.randomUUID();
  const tenantAAdmin = await db.user.create({
    data: { email: `supplier-reconcile-a-${runId}@example.test`, status: 'ACTIVE' },
  });
  const tenantBAdmin = await db.user.create({
    data: { email: `supplier-reconcile-b-${runId}@example.test`, status: 'ACTIVE' },
  });
  const tenantA = await db.organization.create({
    data: {
      name: 'Supplier Reconcile Tenant A',
      slug: `supplier-reconcile-a-${runId}`.slice(0, 63),
      kind: 'TRAVEL_AGENCY',
      timezone: 'UTC',
      currency: 'USD',
    },
  });
  const tenantB = await db.organization.create({
    data: {
      name: 'Supplier Reconcile Tenant B',
      slug: `supplier-reconcile-b-${runId}`.slice(0, 63),
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
      credentialVersion: 7,
    },
  });

  let fingerprintCounter = 0;
  const prepare = async (idempotencyKey: string) => {
    fingerprintCounter += 1;
    return reservations.prepareHospitalitySupplierReservation({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      integrationId: integrationA.id,
      idempotencyKey,
      selection: {
        providerCode: 'travelport-stays',
        supplierPropertyReference: `property-${fingerprintCounter}`,
        supplierOfferReference: `offer-${fingerprintCounter}`,
        offerFingerprint: fingerprintCounter.toString(16).padStart(64, 'a').slice(-64),
        termsFingerprint: fingerprintCounter.toString(16).padStart(64, 'b').slice(-64),
        reservationAuthorityFingerprint: fingerprintCounter.toString(16).padStart(64, 'c').slice(-64),
        reservationPayloadFingerprint: fingerprintCounter.toString(16).padStart(64, 'd').slice(-64),
        currency: 'USD',
        expectedTotalMinor: 125_500n,
        arrivalDateLocal: '2026-10-10',
        departureDateLocal: '2026-10-13',
        rooms: 1,
        adults: 2,
        childAges: [7],
      },
    });
  };

  const makeAmbiguous = async (reservationId: string, providerReservationReference?: string) => {
    const claim = await reservations.claimHospitalitySupplierReservationSubmission({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      reservationId,
    });
    return reservations.settleHospitalitySupplierReservationSubmission({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      reservationId,
      attemptId: claim.attempt.id,
      outcome: {
        status: 'AMBIGUOUS',
        failureCode: 'TIMEOUT',
        ...(providerReservationReference ? { providerReservationReference } : {}),
      },
    });
  };

  try {
    const foundOperation = await prepare('supplier:reconcile:found');
    await makeAmbiguous(foundOperation.id, 'TVPT-FOUND-001');
    const confirmed = await reconciliation.reconcileHospitalitySupplierReservationWithProvider({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      reservationId: foundOperation.id,
      provider: {
        code: 'travelport-stays',
        async retrieveReservation(reference) {
          return {
            status: 'FOUND' as const,
            providerReservationReference: reference,
            supplierConfirmationReference: 'SUPPLIER-FOUND-001',
            providerCorrelationId: 'trace-found-1',
          };
        },
      },
    });
    assert.equal(confirmed.status, 'CONFIRMED');
    assert.equal(confirmed.providerReservationReference, 'TVPT-FOUND-001');
    assert.equal(confirmed.supplierConfirmationReference, 'SUPPLIER-FOUND-001');

    const locatorlessOperation = await prepare('supplier:reconcile:locatorless');
    await makeAmbiguous(locatorlessOperation.id);
    await assert.rejects(
      reservations.claimHospitalitySupplierReservationReconciliation({
        organizationId: tenantA.id,
        actorUserId: tenantAAdmin.id,
        reservationId: locatorlessOperation.id,
      }),
      /without a provider reservation reference/i,
    );
    assert.equal(
      (await db.hospitalitySupplierReservationOperation.findUniqueOrThrow({ where: { id: locatorlessOperation.id } })).status,
      'AMBIGUOUS',
    );

    const transientOperation = await prepare('supplier:reconcile:transient');
    await makeAmbiguous(transientOperation.id, 'TVPT-TRANSIENT-001');
    const stillAmbiguous = await reconciliation.reconcileHospitalitySupplierReservationWithProvider({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      reservationId: transientOperation.id,
      provider: {
        code: 'travelport-stays',
        async retrieveReservation() {
          throw new HospitalitySupplierProviderError('TIMEOUT');
        },
      },
    });
    assert.equal(stillAmbiguous.status, 'AMBIGUOUS');
    assert.equal(stillAmbiguous.providerReservationReference, 'TVPT-TRANSIENT-001');
    assert.equal(stillAmbiguous.lastFailureCode, 'TIMEOUT');

    const safeToRetry = await reconciliation.reconcileHospitalitySupplierReservationWithProvider({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      reservationId: transientOperation.id,
      provider: {
        code: 'travelport-stays',
        async retrieveReservation(reference) {
          return { status: 'NOT_FOUND' as const, providerReservationReference: reference, providerCorrelationId: 'trace-not-found' };
        },
      },
    });
    assert.equal(safeToRetry.status, 'PREPARED');
    assert.equal(safeToRetry.providerReservationReference, null);
    assert.equal(safeToRetry.supplierConfirmationReference, null);

    const mismatchFoundOperation = await prepare('supplier:reconcile:mismatch-found');
    await makeAmbiguous(mismatchFoundOperation.id, 'TVPT-EXPECTED-FOUND-001');
    const mismatchedFound = await reconciliation.reconcileHospitalitySupplierReservationWithProvider({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      reservationId: mismatchFoundOperation.id,
      provider: {
        code: 'travelport-stays',
        async retrieveReservation() {
          return {
            status: 'FOUND' as const,
            providerReservationReference: 'TVPT-DIFFERENT-FOUND-001',
            supplierConfirmationReference: 'SUPPLIER-DIFFERENT-001',
            providerCorrelationId: 'trace-mismatch-found',
          };
        },
      },
    });
    assert.equal(mismatchedFound.status, 'AMBIGUOUS');
    assert.equal(mismatchedFound.providerReservationReference, 'TVPT-EXPECTED-FOUND-001');
    assert.equal(mismatchedFound.supplierConfirmationReference, null);
    assert.equal(mismatchedFound.lastFailureCode, 'INVALID_RESPONSE');

    const mismatchNotFoundOperation = await prepare('supplier:reconcile:mismatch-not-found');
    await makeAmbiguous(mismatchNotFoundOperation.id, 'TVPT-EXPECTED-NOT-FOUND-001');
    const mismatchedNotFound = await reconciliation.reconcileHospitalitySupplierReservationWithProvider({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      reservationId: mismatchNotFoundOperation.id,
      provider: {
        code: 'travelport-stays',
        async retrieveReservation() {
          return {
            status: 'NOT_FOUND' as const,
            providerReservationReference: 'TVPT-DIFFERENT-NOT-FOUND-001',
            providerCorrelationId: 'trace-mismatch-not-found',
          };
        },
      },
    });
    assert.equal(mismatchedNotFound.status, 'AMBIGUOUS');
    assert.equal(mismatchedNotFound.providerReservationReference, 'TVPT-EXPECTED-NOT-FOUND-001');
    assert.equal(mismatchedNotFound.supplierConfirmationReference, null);
    assert.equal(mismatchedNotFound.lastFailureCode, 'INVALID_RESPONSE');

    const tenantOperation = await prepare('supplier:reconcile:tenant-order');
    await makeAmbiguous(tenantOperation.id, 'TVPT-TENANT-001');
    let providerCalls = 0;
    await assert.rejects(
      reconciliation.reconcileHospitalitySupplierReservationWithProvider({
        organizationId: tenantB.id,
        actorUserId: tenantBAdmin.id,
        reservationId: tenantOperation.id,
        provider: {
          code: 'travelport-stays',
          async retrieveReservation(reference) {
            providerCalls += 1;
            return { status: 'NOT_FOUND' as const, providerReservationReference: reference, providerCorrelationId: null };
          },
        },
      }),
      /not available/i,
    );
    assert.equal(providerCalls, 0);
    assert.equal(
      (await db.hospitalitySupplierReservationOperation.findUniqueOrThrow({ where: { id: tenantOperation.id } })).status,
      'AMBIGUOUS',
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
