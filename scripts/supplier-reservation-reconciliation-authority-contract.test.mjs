import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const authority = await readFile(
  new URL('../src/server/suppliers/hospitality-supplier-reservation-reconciliation-authority.ts', import.meta.url),
  'utf8',
);
const coordinator = await readFile(
  new URL('../src/server/suppliers/hospitality-supplier-reservation-reconciliation-service.ts', import.meta.url),
  'utf8',
);
const documentation = await readFile(
  new URL('../docs/supplier-reservation-reconciliation-authority.md', import.meta.url),
  'utf8',
);

test('reconciliation runtime authority semantically bounds provider identity and provider result evidence', () => {
  assert.match(authority, /MAX_PROVIDER_CODE_LENGTH = 64/);
  assert.match(authority, /MAX_OPERATIONAL_REFERENCE_LENGTH = 512/);
  assert.match(authority, /isExactHospitalitySupplierMachineToken\(code, MAX_PROVIDER_CODE_LENGTH\)/);
  assert.match(authority, /status !== 'FOUND' && status !== 'NOT_FOUND'/);
  assert.match(authority, /normalizedProviderReservationReference = exactMachineToken/);
  assert.match(authority, /normalizedProviderCorrelationId = nullableMachineToken/);
  assert.match(authority, /normalizedSupplierConfirmationReference = nullableMachineToken/);
  assert.match(authority, /normalizedContradictorySupplierConfirmationReference/);
  assert.match(authority, /HospitalitySupplierProviderError\(code, message\)/);
});

test('coordinator still materializes provider results before locator and confirmation decisions', () => {
  const materialization = coordinator.indexOf('materializeHospitalitySupplierReservationRecoveryResult(rawResult)');
  const locatorCheck = coordinator.indexOf('result.providerReservationReference !== providerReservationReference', materialization);
  const confirmationRead = coordinator.indexOf('rawSupplierConfirmationReference', locatorCheck);
  const foundBranch = coordinator.indexOf("if (result.status === 'FOUND')", confirmationRead);
  const notFoundBranch = coordinator.indexOf("if (result.status === 'NOT_FOUND')", foundBranch);
  assert.ok(materialization >= 0 && locatorCheck > materialization);
  assert.ok(confirmationRead > locatorCheck && foundBranch > confirmationRead && notFoundBranch > foundBranch);
});

test('documentation keeps semantic hardening separate from Travelport activation claims', () => {
  assert.match(documentation, /trim-stable, control-free machine token of at most 64 characters/);
  assert.match(documentation, /provider reservation reference.*at most 512 characters/i);
  assert.match(documentation, /unexpected non-null supplier confirmation.*bounded contradictory evidence/i);
  assert.match(documentation, /Travelport `reservation` remains deliberately disabled/);
  assert.match(documentation, /does not provide a PCI-safe FormOfPayment\/guarantee source/);
});
