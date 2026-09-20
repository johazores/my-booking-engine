import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const bondService = read('src/server/payments/rental-security-bond-service.ts');
const damageService = read('src/server/payments/rental-damage-settlement-service.ts');
const forfeitureMigration = read('prisma/migrations/20260917060000_rental_security_bond_forfeiture/migration.sql');
const docs = read('docs/rental-terminal-settlement-pre-provider-authority.md');

test('security-bond release shares terminal disposition authority before manual refund adapter invocation', () => {
  assert.match(bondService, /sf:rental-security-bond-disposition:/);
  assert.match(forfeitureMigration, /sf:rental-security-bond-disposition:/);

  const releaseFlow = bondService.indexOf('recordManualBondEvidence');
  const dispositionLock = bondService.indexOf('bondDispositionLockKey(input.organizationId, expectedBondId)', releaseFlow);
  const refresh = bondService.indexOf('const refreshedState = await loadBondState', dispositionLock);
  const replayLookup = bondService.indexOf('const existing = await transaction.rentalSecurityBondTransaction.findUnique', refresh);
  const forfeitureRead = bondService.indexOf('rentalSecurityBondForfeiture.findFirst', replayLookup);
  const providerRefund = bondService.indexOf('manualProvider.recordOfflineRefund', forfeitureRead);

  assert.ok(dispositionLock > releaseFlow, 'release must acquire the shared terminal disposition lock');
  assert.ok(refresh > dispositionLock, 'release must refresh retained bond state after acquiring terminal authority');
  assert.ok(replayLookup > refresh, 'release replay lookup must use the post-lock state');
  assert.ok(forfeitureRead > replayLookup, 'fresh release must preserve exact replay before checking alternate terminal disposition');
  assert.ok(providerRefund > forfeitureRead, 'forfeiture must be rejected before the manual refund adapter is invoked');
  assert.match(bondService, /Forfeited security bond cannot also be released/);
  assert.match(forfeitureMigration, /forfeited rental security bond cannot also be released/);
});

test('fresh damage payment shares liability-settlement authority and rejects bond forfeiture before adapter invocation', () => {
  assert.match(damageService, /sf:rental-damage-liability-settlement:/);
  assert.match(forfeitureMigration, /sf:rental-damage-liability-settlement:/);

  const paymentFlow = damageService.indexOf('recordRentalDamageManualOfflinePayment');
  const liabilityLock = damageService.indexOf('liabilitySettlementLockKey(input.organizationId, liability.id)', paymentFlow);
  const replayLookup = damageService.indexOf('const existing = await transaction.rentalDamageSettlementTransaction.findUnique', liabilityLock);
  const forfeitureRead = damageService.indexOf('rentalSecurityBondForfeiture.findFirst', replayLookup);
  const manualReference = damageService.indexOf('assertManualReferenceUnused(transaction, input.organizationId, reference)', forfeitureRead);
  const providerPayment = damageService.indexOf('manualProvider.recordOfflinePayment', manualReference);

  assert.ok(liabilityLock > paymentFlow, 'damage payment must acquire shared liability-settlement authority');
  assert.ok(replayLookup > liabilityLock, 'damage payment replay lookup must occur under terminal settlement authority');
  assert.ok(forfeitureRead > replayLookup, 'fresh payment must preserve exact replay before alternate settlement rejection');
  assert.ok(manualReference > forfeitureRead, 'bond forfeiture must be rejected before reserving a new manual reference');
  assert.ok(providerPayment > manualReference, 'provider recording must remain after terminal settlement and manual-reference authority');
  assert.match(damageService, /Customer damage liability is already settled by security bond forfeiture/);
  assert.match(forfeitureMigration, /customer damage liability is already settled by security bond forfeiture/);
});

test('damage refund uses the same liability settlement lock before refund adapter invocation', () => {
  const refundFlow = damageService.indexOf('recordRentalDamageManualOfflineRefund');
  const liabilityLock = damageService.indexOf('liabilitySettlementLockKey(input.organizationId, liability.id)', refundFlow);
  const providerRefund = damageService.indexOf('manualProvider.recordOfflineRefund', liabilityLock);
  assert.ok(liabilityLock > refundFlow);
  assert.ok(providerRefund > liabilityLock);
});

test('documentation keeps application and PostgreSQL terminal-settlement authority aligned without changing release-after-custody policy', () => {
  assert.match(docs, /same advisory locks before invoking the manual payment adapter/i);
  assert.match(docs, /release can still be recorded after the pickup window closes or custody begins/i);
  assert.match(docs, /fails before manual-reference reservation and before `ManualPaymentProvider\.recordOfflinePayment`/);
  assert.match(docs, /No schema change or new migration is required/);
  assert.match(docs, /GitHub Actions are not required or used/);
});
