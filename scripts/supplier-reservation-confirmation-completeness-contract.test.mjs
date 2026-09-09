import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('fresh supplier confirmation completeness is preserved through durable settlement and reconciliation', () => {
  const evidence = source('src/server/suppliers/hospitality-supplier-reservation-confirmation-evidence.ts');
  const mapper = source('src/server/suppliers/travelport-stays-reservation-submission-outcome.ts');
  const reconciliation = source('src/server/suppliers/hospitality-supplier-reservation-reconciliation-service.ts');

  assert.match(
    evidence,
    /HOSPITALITY_SUPPLIER_CONFIRMATION_MISSING_FAILURE_CODE\s*=\s*[\s\S]*?'SUPPLIER_CONFIRMATION_MISSING'/,
  );
  assert.match(evidence, /requiresSupplierConfirmationForReservationRecovery/);

  const confirmedIndex = mapper.indexOf("if (outcome.status === 'CONFIRMED')");
  const missingSupplierIndex = mapper.indexOf('if (!outcome.supplierConfirmationReference)', confirmedIndex);
  const confirmedReturnIndex = mapper.indexOf("status: 'CONFIRMED'", missingSupplierIndex);
  assert.ok(confirmedIndex >= 0 && missingSupplierIndex > confirmedIndex && confirmedReturnIndex > missingSupplierIndex);
  assert.match(mapper, /status: 'AMBIGUOUS'[\s\S]*?providerReservationReference: outcome\.providerReservationReference/);
  assert.match(mapper, /HOSPITALITY_SUPPLIER_CONFIRMATION_MISSING_FAILURE_CODE/);

  const foundIndex = reconciliation.indexOf("if (result.status === 'FOUND')");
  const recoveryRequirementIndex = reconciliation.indexOf(
    'requiresSupplierConfirmationForReservationRecovery(claim.reservation.lastFailureCode)',
    foundIndex,
  );
  const supplierCheckIndex = reconciliation.indexOf('!supplierConfirmationReference', recoveryRequirementIndex);
  const foundSettlementIndex = reconciliation.indexOf("status: 'FOUND'", supplierCheckIndex);
  assert.ok(
    foundIndex >= 0
      && recoveryRequirementIndex > foundIndex
      && supplierCheckIndex > recoveryRequirementIndex
      && foundSettlementIndex > supplierCheckIndex,
  );
  assert.match(
    reconciliation,
    /status: 'UNKNOWN'[\s\S]*?failureCode: HOSPITALITY_SUPPLIER_CONFIRMATION_MISSING_FAILURE_CODE/,
  );
  assert.match(
    reconciliation,
    /supplierConfirmationMatchesDurableReservation\([\s\S]*?claim\.reservation\.supplierConfirmationReference,[\s\S]*?supplierConfirmationReference/,
  );
});
