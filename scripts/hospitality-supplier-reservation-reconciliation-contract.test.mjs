import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('known-locator ambiguity remains durable until provider truth is resolved', async () => {
  const [schema, migration, service] = await Promise.all([
    source('prisma/hospitality-supplier-reservations.prisma'),
    source('prisma/migrations/20260906112500_supplier-reservation-confirmation-evidence/migration.sql'),
    source('src/server/suppliers/hospitality-supplier-reservation-service.ts'),
  ]);

  assert.match(schema, /supplierConfirmationReference\s+String\?/);
  assert.match(migration, /ADD COLUMN "supplierConfirmationReference" VARCHAR\(512\)/);
  assert.match(migration, /"status" IN \('AMBIGUOUS', 'RECONCILING'\)/);
  assert.match(migration, /provider_reference_format_check/);
  assert.match(migration, /supplier_confirmation_reference_check/);

  assert.match(service, /status: 'AMBIGUOUS'[\s\S]*?providerReservationReference\?: unknown/);
  assert.match(service, /cannot be reconciled automatically without a provider reservation reference/i);
  assert.match(service, /status: 'NOT_FOUND'[\s\S]*?providerReservationReference: unknown/);
  assert.match(service, /input\.outcome\.status === 'FOUND' \|\| input\.outcome\.status === 'NOT_FOUND'[\s\S]*?reservation\.providerReservationReference !== providerReservationReference/);
  assert.match(service, /input\.outcome\.status === 'NOT_FOUND'[\s\S]*?\? null[\s\S]*?: reservation\.providerReservationReference/);
  assert.match(service, /input\.outcome\.status === 'NOT_FOUND'[\s\S]*?\? null[\s\S]*?: reservation\.supplierConfirmationReference/);
  assert.match(service, /recovery returned a different provider reservation reference/i);
});

test('confirmed supplier evidence is normalized and settled atomically without entering audits', async () => {
  const [domain, service] = await Promise.all([
    source('src/server/suppliers/hospitality-supplier-reservation-domain.ts'),
    source('src/server/suppliers/hospitality-supplier-reservation-service.ts'),
  ]);

  assert.match(domain, /normalizeHospitalitySupplierReservationSupplierConfirmationReference/);
  assert.match(service, /status: 'CONFIRMED'[\s\S]*?supplierConfirmationReference\?: unknown/);
  assert.match(service, /status: 'FOUND'[\s\S]*?supplierConfirmationReference\?: unknown/);
  assert.match(service, /supplierConfirmationReference: nextSupplierConfirmationReference/);

  const auditBlocks = [...service.matchAll(/afterData: \{([\s\S]*?)\n        \},/g)].map((match) => match[1]).join('\n');
  assert.doesNotMatch(
    auditBlocks,
    /supplierPropertyReference|supplierOfferReference|providerReservationReference|supplierConfirmationReference|lastProviderCorrelationId|reservationPayloadFingerprint/,
  );
});

test('provider-neutral coordinator authorizes and claims before provider I/O and always settles normalized recovery outcomes', async () => {
  const [coordinator, recoveryContract, runner, operationsDoc, responseDoc, travelportDoc] = await Promise.all([
    source('src/server/suppliers/hospitality-supplier-reservation-reconciliation-service.ts'),
    source('src/server/suppliers/hospitality-supplier-reservation-recovery-provider.ts'),
    source('scripts/run-database-tests.mjs'),
    source('docs/supplier-reservation-operations.md'),
    source('docs/travelport-reservation-response-evidence.md'),
    source('docs/travelport-stays-integration.md'),
  ]);

  assert.match(coordinator, /HospitalitySupplierReservationRecoveryProvider/);
  assert.doesNotMatch(recoveryContract, /Travelport|credentials|accessToken|ReservationResponse/);
  const claimIndex = coordinator.indexOf('claimHospitalitySupplierReservationReconciliation');
  const providerIoIndex = coordinator.indexOf('input.provider.retrieveReservation');
  assert.ok(claimIndex >= 0 && providerIoIndex > claimIndex);
  assert.match(coordinator, /input\.provider\.code !== claim\.reservation\.providerCode/);
  assert.match(coordinator, /error instanceof HospitalitySupplierProviderError \? error\.code : 'PROVIDER_UNAVAILABLE'/);
  assert.match(coordinator, /status: 'FOUND'/);
  assert.match(coordinator, /status: 'NOT_FOUND'[\s\S]*?providerReservationReference: result\.providerReservationReference/);
  assert.match(coordinator, /status: 'UNKNOWN'/);
  assert.doesNotMatch(coordinator, /error\.message|responseBody|requestPayload|encryptedCredentials|accessToken|cardNumber|cvv/i);
  assert.match(runner, /hospitality-supplier-reservation-reconciliation\.integration\.ts/);
  for (const doc of [operationsDoc, responseDoc, travelportDoc]) {
    assert.match(doc, /supplier confirmation/i);
    assert.doesNotMatch(doc, /does not yet persist the supplier confirmation reference/i);
  }
  assert.match(operationsDoc, /UNKNOWN[\s\S]*preserv/i);
  assert.match(operationsDoc, /locator-less ambiguity/i);
  assert.match(travelportDoc, /does not yet advertise `reservation`|does not yet advertise `reservation`/i);
});
