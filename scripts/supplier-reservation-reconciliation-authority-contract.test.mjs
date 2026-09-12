import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');

test('reconciliation coordinator snapshots caller, provider capability, and provider result authority', async () => {
  const authority = await source('src/server/suppliers/hospitality-supplier-reservation-reconciliation-authority.ts');
  assert.match(authority, /Object\.freeze\(\{/);
  assert.match(authority, /organizationId: record\.organizationId/);
  assert.match(authority, /retrieveReservation = record\.retrieveReservation/);
  assert.match(authority, /Reflect\.apply\(retrieveReservation, provider/);
  assert.match(authority, /status: record\.status/);
  assert.match(authority, /HospitalitySupplierProviderError\(code, message\)/);
  assert.match(authority, /INVALID_RESPONSE/);
});

test('reconciliation service uses stable authority for durable claim, provider call, and settlement', async () => {
  const service = await source('src/server/suppliers/hospitality-supplier-reservation-reconciliation-service.ts');
  assert.match(service, /const authority = materializeHospitalitySupplierReservationReconciliationInput\(input\)/);
  assert.match(service, /organizationId: authority\.organizationId/);
  assert.match(service, /materializeHospitalitySupplierReservationRecoveryProvider\(authority\.provider\)/);
  assert.match(service, /rawResult = await provider\.retrieveReservation/);
  assert.match(service, /result = materializeHospitalitySupplierReservationRecoveryResult\(rawResult\)/);
  assert.doesNotMatch(service, /input\.organizationId/);
  assert.doesNotMatch(service, /input\.actorUserId/);
  assert.doesNotMatch(service, /input\.reservationId/);
  assert.doesNotMatch(service, /input\.provider\./);
});

test('reconciliation authority documentation keeps activation and privacy limits explicit', async () => {
  const docs = await source('docs/supplier-reservation-reconciliation-authority.md');
  assert.match(docs, /tenant-scoped durable `RECONCILE` claim/);
  assert.match(docs, /provider capability/);
  assert.match(docs, /provider result/);
  assert.match(docs, /Travelport `reservation` remains deliberately disabled/);
  assert.match(docs, /No provider payload, credential, token, traveler PII, or payment-card data/);
});
