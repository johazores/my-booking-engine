import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('provider-neutral NOT_FOUND requires explicit exact-locator negative authority', async () => {
  const [recoveryContract, authority, coordinator, travelportRecovery, travelportNegativeEvidence, integration, operationsDoc] = await Promise.all([
    source('src/server/suppliers/hospitality-supplier-reservation-recovery-provider.ts'),
    source('src/server/suppliers/hospitality-supplier-reservation-reconciliation-authority.ts'),
    source('src/server/suppliers/hospitality-supplier-reservation-reconciliation-service.ts'),
    source('src/server/suppliers/travelport-stays-reservation-recovery-provider.ts'),
    source('src/server/suppliers/travelport-stays-reservation-negative-evidence.ts'),
    source('src/server/suppliers/hospitality-supplier-reservation-reconciliation.integration.ts'),
    source('docs/supplier-reservation-operations.md'),
  ]);

  assert.match(recoveryContract, /supportsAuthoritativeNotFound\?: boolean/);
  assert.match(authority, /supportsAuthoritativeNotFound: boolean/);
  assert.match(authority, /supportsAuthoritativeNotFound: supportsAuthoritativeNotFound === true/);
  assert.match(authority, /supportsAuthoritativeNotFound !== undefined[\s\S]*?typeof supportsAuthoritativeNotFound !== 'boolean'/);

  const notFoundBranchIndex = coordinator.indexOf("if (result.status === 'NOT_FOUND')");
  const confirmationCheckIndex = coordinator.indexOf('hospitalitySupplierReservationRecoveryConfirmationFailureCode', notFoundBranchIndex);
  const guardIndex = coordinator.indexOf('if (!provider.supportsAuthoritativeNotFound)', confirmationCheckIndex);
  const failedObservationIndex = coordinator.indexOf("status: 'FAILED', failureCode: 'INVALID_RESPONSE'", guardIndex);
  const unknownSettlementIndex = coordinator.indexOf("status: 'UNKNOWN'", failedObservationIndex);
  const notFoundSuccessIndex = coordinator.indexOf("providerResult: 'NOT_FOUND'", unknownSettlementIndex);
  assert.ok(
    notFoundBranchIndex >= 0
    && confirmationCheckIndex > notFoundBranchIndex
    && guardIndex > confirmationCheckIndex
    && failedObservationIndex > guardIndex
    && unknownSettlementIndex > failedObservationIndex
    && notFoundSuccessIndex > unknownSettlementIndex,
  );
  assert.match(
    coordinator.slice(guardIndex, notFoundSuccessIndex),
    /failureCode: 'INVALID_RESPONSE'[\s\S]*?providerCorrelationId/,
  );

  assert.match(travelportRecovery, /readonly supportsAuthoritativeNotFound = true/);
  assert.match(travelportNegativeEvidence, /AUTHORITATIVE_RESERVATION_NOT_FOUND_SOURCE_CODE = '13061'/);
  assert.match(operationsDoc, /NOT_FOUND[\s\S]*authoritative exact-locator negative semantics/i);

  assert.match(
    integration,
    /supplier:reconcile:transient[\s\S]*?supportsAuthoritativeNotFound: true[\s\S]*?assert\.equal\(safeToRetry\.status, 'PREPARED'\)/,
  );
  assert.match(
    integration,
    /supplier:reconcile:undeclared-not-found[\s\S]*?assert\.equal\(undeclaredNotFound\.status, 'AMBIGUOUS'\)[\s\S]*?assert\.equal\(undeclaredNotFound\.lastFailureCode, 'INVALID_RESPONSE'\)/,
  );
});
