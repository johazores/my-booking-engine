import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('recovery normalizes provider evidence and never replaces or erases a known supplier confirmation', () => {
  const evidence = source('src/server/suppliers/hospitality-supplier-reservation-confirmation-evidence.ts');
  const reconciliation = source('src/server/suppliers/hospitality-supplier-reservation-reconciliation-service.ts');
  const ledger = source('src/server/suppliers/hospitality-supplier-reservation-service.ts');

  assert.match(
    evidence,
    /HOSPITALITY_SUPPLIER_CONFIRMATION_MISMATCH_FAILURE_CODE\s*=\s*[\s\S]*?'SUPPLIER_CONFIRMATION_MISMATCH'/,
  );
  assert.match(evidence, /supplierConfirmationMatchesDurableReservation/);
  assert.match(evidence, /status === 'NOT_FOUND'[\s\S]*?HOSPITALITY_SUPPLIER_CONFIRMATION_MISMATCH_FAILURE_CODE/);

  const providerCall = reconciliation.indexOf('await input.provider.retrieveReservation');
  const correlationNormalization = reconciliation.indexOf(
    'normalizeHospitalitySupplierReservationCorrelationId(result.providerCorrelationId)',
    providerCall,
  );
  const supplierNormalization = reconciliation.indexOf(
    'normalizeHospitalitySupplierReservationSupplierConfirmationReference(',
    correlationNormalization,
  );
  const foundBranch = reconciliation.indexOf("if (result.status === 'FOUND')", supplierNormalization);
  const foundConfirmationCheck = reconciliation.indexOf(
    'hospitalitySupplierReservationRecoveryConfirmationFailureCode({',
    foundBranch,
  );
  const foundSuccess = reconciliation.indexOf("providerResult: 'FOUND'", foundConfirmationCheck);
  const foundSettlement = reconciliation.indexOf("status: 'FOUND'", foundSuccess);
  const notFoundBranch = reconciliation.indexOf("if (result.status === 'NOT_FOUND')", foundSettlement);
  const notFoundConfirmationCheck = reconciliation.indexOf(
    'hospitalitySupplierReservationRecoveryConfirmationFailureCode({',
    notFoundBranch,
  );
  const notFoundSuccess = reconciliation.indexOf("providerResult: 'NOT_FOUND'", notFoundConfirmationCheck);

  assert.ok(providerCall >= 0);
  assert.ok(correlationNormalization > providerCall);
  assert.ok(supplierNormalization > correlationNormalization);
  assert.ok(foundBranch > supplierNormalization);
  assert.ok(foundConfirmationCheck > foundBranch);
  assert.ok(foundSuccess > foundConfirmationCheck);
  assert.ok(foundSettlement > foundSuccess);
  assert.ok(notFoundBranch > foundSettlement);
  assert.ok(notFoundConfirmationCheck > notFoundBranch);
  assert.ok(notFoundSuccess > notFoundConfirmationCheck);
  assert.match(
    reconciliation.slice(foundConfirmationCheck, foundSuccess),
    /providerObservation\.finish\(\{ status: 'FAILED', failureCode: 'INVALID_RESPONSE' \}\)/,
  );
  assert.match(
    reconciliation.slice(notFoundConfirmationCheck, notFoundSuccess),
    /providerObservation\.finish\(\{ status: 'FAILED', failureCode: 'INVALID_RESPONSE' \}\)/,
  );
  assert.match(
    reconciliation.slice(foundSuccess, foundSettlement + 300),
    /supplierConfirmationReference,\n\s+providerCorrelationId,/,
  );
  assert.doesNotMatch(
    reconciliation.slice(foundSuccess, foundSettlement + 300),
    /supplierConfirmationReference: result\.supplierConfirmationReference/,
  );

  const ledgerSettlement = ledger.indexOf('settleHospitalitySupplierReservationReconciliation');
  const ledgerConfirmationCheck = ledger.indexOf(
    'hospitalitySupplierReservationRecoveryConfirmationFailureCode({',
    ledgerSettlement,
  );
  const effectiveStatus = ledger.indexOf('effectiveOutcomeStatus', ledgerConfirmationCheck);
  const preservedProvider = ledger.indexOf(': reservation.providerReservationReference;', effectiveStatus);
  const preservedSupplier = ledger.indexOf(': reservation.supplierConfirmationReference;', effectiveStatus);
  assert.ok(ledgerConfirmationCheck > ledgerSettlement);
  assert.ok(effectiveStatus > ledgerConfirmationCheck);
  assert.ok(preservedProvider > effectiveStatus);
  assert.ok(preservedSupplier > effectiveStatus);
  assert.match(
    ledger.slice(ledgerConfirmationCheck, effectiveStatus + 300),
    /durableSupplierConfirmationReference: reservation\.supplierConfirmationReference/,
  );
});
