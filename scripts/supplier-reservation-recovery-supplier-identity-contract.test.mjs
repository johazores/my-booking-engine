import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('recovery normalizes provider evidence and never replaces a known supplier confirmation', () => {
  const evidence = source('src/server/suppliers/hospitality-supplier-reservation-confirmation-evidence.ts');
  const reconciliation = source('src/server/suppliers/hospitality-supplier-reservation-reconciliation-service.ts');

  assert.match(
    evidence,
    /HOSPITALITY_SUPPLIER_CONFIRMATION_MISMATCH_FAILURE_CODE\s*=\s*[\s\S]*?'SUPPLIER_CONFIRMATION_MISMATCH'/,
  );
  assert.match(evidence, /supplierConfirmationMatchesDurableReservation/);

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
  const durableSupplierCheck = reconciliation.indexOf(
    'supplierConfirmationMatchesDurableReservation(',
    foundBranch,
  );
  const foundSuccess = reconciliation.indexOf("providerResult: 'FOUND'", durableSupplierCheck);
  const foundSettlement = reconciliation.indexOf("status: 'FOUND'", foundSuccess);

  assert.ok(providerCall >= 0);
  assert.ok(correlationNormalization > providerCall);
  assert.ok(supplierNormalization > correlationNormalization);
  assert.ok(foundBranch > supplierNormalization);
  assert.ok(durableSupplierCheck > foundBranch);
  assert.ok(foundSuccess > durableSupplierCheck);
  assert.ok(foundSettlement > foundSuccess);
  assert.match(
    reconciliation.slice(durableSupplierCheck, foundSuccess),
    /status: 'UNKNOWN'[\s\S]*?HOSPITALITY_SUPPLIER_CONFIRMATION_MISMATCH_FAILURE_CODE/,
  );
  assert.match(
    reconciliation.slice(durableSupplierCheck, foundSuccess),
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
});
