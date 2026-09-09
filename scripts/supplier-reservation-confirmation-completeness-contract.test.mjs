import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('fresh supplier confirmation completeness is preserved through durable settlement and reconciliation', () => {
  const evidence = source('src/server/suppliers/hospitality-supplier-reservation-confirmation-evidence.ts');
  const recoveryContract = source('src/server/suppliers/hospitality-supplier-reservation-recovery-provider.ts');
  const mapper = source('src/server/suppliers/travelport-stays-reservation-submission-outcome.ts');
  const travelportRecovery = source('src/server/suppliers/travelport-stays-reservation-recovery-provider.ts');
  const reconciliation = source('src/server/suppliers/hospitality-supplier-reservation-reconciliation-service.ts');
  const ledger = source('src/server/suppliers/hospitality-supplier-reservation-service.ts');

  assert.match(
    evidence,
    /HOSPITALITY_SUPPLIER_CONFIRMATION_MISSING_FAILURE_CODE\s*=\s*[\s\S]*?'SUPPLIER_CONFIRMATION_MISSING'/,
  );
  assert.match(evidence, /requiresSupplierConfirmationForReservationRecovery/);
  assert.match(evidence, /hospitalitySupplierReservationRecoveryConfirmationFailureCode/);
  assert.match(recoveryContract, /readonly requiresSupplierConfirmationForFound\?: boolean/);
  assert.match(travelportRecovery, /readonly requiresSupplierConfirmationForFound = true/);

  const confirmedIndex = mapper.indexOf("if (outcome.status === 'CONFIRMED')");
  const missingSupplierIndex = mapper.indexOf('if (!outcome.supplierConfirmationReference)', confirmedIndex);
  const confirmedReturnIndex = mapper.indexOf("status: 'CONFIRMED'", missingSupplierIndex);
  assert.ok(confirmedIndex >= 0 && missingSupplierIndex > confirmedIndex && confirmedReturnIndex > missingSupplierIndex);
  assert.match(mapper, /status: 'AMBIGUOUS'[\s\S]*?providerReservationReference: outcome\.providerReservationReference/);
  assert.match(mapper, /HOSPITALITY_SUPPLIER_CONFIRMATION_MISSING_FAILURE_CODE/);

  const foundIndex = reconciliation.indexOf("if (result.status === 'FOUND')");
  const confirmationCheckIndex = reconciliation.indexOf(
    'hospitalitySupplierReservationRecoveryConfirmationFailureCode({',
    foundIndex,
  );
  const providerCompletenessIndex = reconciliation.indexOf(
    'input.provider.requiresSupplierConfirmationForFound === true',
    confirmationCheckIndex,
  );
  const foundSuccessIndex = reconciliation.indexOf("providerResult: 'FOUND'", providerCompletenessIndex);
  const foundSettlementIndex = reconciliation.indexOf("status: 'FOUND'", foundSuccessIndex);
  assert.ok(
    foundIndex >= 0
      && confirmationCheckIndex > foundIndex
      && providerCompletenessIndex > confirmationCheckIndex
      && foundSuccessIndex > providerCompletenessIndex
      && foundSettlementIndex > foundSuccessIndex,
  );
  assert.match(
    reconciliation.slice(confirmationCheckIndex, foundSuccessIndex),
    /HOSPITALITY_SUPPLIER_CONFIRMATION_MISSING_FAILURE_CODE[\s\S]*?status: 'UNKNOWN'[\s\S]*?failureCode: confirmationFailureCode/,
  );

  const ledgerSettlementIndex = ledger.indexOf('settleHospitalitySupplierReservationReconciliation');
  const ledgerConfirmationCheckIndex = ledger.indexOf(
    'hospitalitySupplierReservationRecoveryConfirmationFailureCode({',
    ledgerSettlementIndex,
  );
  const effectiveStatusIndex = ledger.indexOf('const effectiveOutcomeStatus = confirmationFailureCode', ledgerConfirmationCheckIndex);
  const nextStatusIndex = ledger.indexOf('const nextStatus = effectiveOutcomeStatus', effectiveStatusIndex);
  assert.ok(ledgerConfirmationCheckIndex > ledgerSettlementIndex);
  assert.ok(effectiveStatusIndex > ledgerConfirmationCheckIndex);
  assert.ok(nextStatusIndex > effectiveStatusIndex);
  assert.match(
    ledger.slice(ledgerConfirmationCheckIndex, nextStatusIndex),
    /effectiveFailureCode = confirmationFailureCode \?\? failureCode/,
  );
  assert.doesNotMatch(
    ledger.slice(nextStatusIndex),
    /supplierConfirmationReference \?\? reservation\.supplierConfirmationReference/,
  );
});
