import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');

test('recovery input materializer is frozen, sanitized, and branch-specific', async () => {
  const authority = await source('src/server/suppliers/hospitality-supplier-reservation-recovery-input-authority.ts');
  assert.match(authority, /Object\.freeze\(\{/);
  assert.match(authority, /catch \{\s*invalidAuthority\(\)/s);
  assert.match(authority, /requireFreshProviderRequest: rawFreshRequirement \?\? false/);
  assert.match(authority, /if \(status === 'CONFIRMED'\)/);
  assert.match(authority, /else if \(status === 'FAILED'\)/);
  assert.match(authority, /typeof retryable !== 'boolean'/);
  assert.match(authority, /else if \(status === 'AMBIGUOUS'\)/);
  assert.doesNotMatch(authority, /throw error/);
});

test('provider marker and stale recovery use stable authority after entry', async () => {
  const service = await source('src/server/suppliers/hospitality-supplier-reservation-attempt-recovery-service.ts');
  assert.match(service, /materializeHospitalitySupplierReservationProviderRequestInput\(input\)/);
  assert.match(service, /materializeHospitalitySupplierReservationRecoveryScope\(input\)/);
  assert.match(service, /authority\.requireFreshProviderRequest/);
  assert.doesNotMatch(service, /input\.organizationId|input\.actorUserId|input\.reservationId|input\.attemptId|input\.requireFreshProviderRequest/);
});

test('recovery evidence and recovery-write lifecycle use stable authority', async () => {
  const [evidence, recoveryWrite] = await Promise.all([
    source('src/server/suppliers/hospitality-supplier-reservation-recovery-evidence-service.ts'),
    source('src/server/suppliers/hospitality-supplier-reservation-recovery-write-service.ts'),
  ]);

  assert.match(evidence, /materializeHospitalitySupplierReservationRecoveryEvidenceInput\(input\)/);
  assert.match(evidence, /authority\.supplierConfirmationReference/);
  assert.match(evidence, /authority\.providerRecoveryReference/);
  assert.doesNotMatch(evidence, /input\.organizationId|input\.actorUserId|input\.reservationId|input\.attemptId|input\.supplierConfirmationReference|input\.providerRecoveryReference/);

  assert.match(recoveryWrite, /materializeHospitalitySupplierReservationRecoveryWriteClaimInput\(input\)/);
  assert.match(recoveryWrite, /materializeHospitalitySupplierReservationRecoveryWriteSettlementInput\(input\)/);
  assert.match(recoveryWrite, /const outcome = authority\.outcome/);
  assert.doesNotMatch(recoveryWrite, /input\.organizationId|input\.actorUserId|input\.reservationId|input\.attemptId|input\.reservationPayloadFingerprint|input\.outcome/);
});

test('documentation keeps authorization, privacy, and activation limits explicit', async () => {
  const docs = await source('docs/supplier-reservation-recovery-input-authority.md');
  assert.match(docs, /Materialization is not authorization/);
  assert.match(docs, /server-side `booking:manage`/);
  assert.match(docs, /provider marking, stale recovery, staged recovery evidence, recovery-write claim, and recovery-write settlement/);
  assert.match(docs, /Travelport `reservation` remains deliberately disabled/);
  assert.match(docs, /PAN\/CVV/);
});
