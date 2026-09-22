import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFileSync(new URL(path, root), 'utf8');

test('Travelport known-locator retry authority requires the documented 13061 provider error contract', () => {
  const adapter = source('src/server/suppliers/travelport-stays-reservation-recovery-provider.ts');
  const negativeEvidence = source('src/server/suppliers/travelport-stays-reservation-negative-evidence.ts');
  const focusedTest = source('src/server/suppliers/travelport-stays-reservation-negative-evidence.test.ts');
  const docs = source('docs/supplier-reservation-reconciliation-authority.md');
  const correlationDocs = source('docs/supplier-reservation-correlation.md');

  assert.match(adapter, /readonly supportsAuthoritativeNotFound = true/);
  assert.match(adapter, /inspectTravelportStaysReservationNegativeEvidence/);
  assert.doesNotMatch(adapter, /response\.status === 404[\s\S]*?status:\s*'NOT_FOUND'/);

  const payloadRead = adapter.indexOf('const payload = await response.json().catch(() => null)');
  const failureBranch = adapter.indexOf('if (!response.ok)', payloadRead);
  const negativeInspection = adapter.indexOf('inspectTravelportStaysReservationNegativeEvidence(payload, response.status)', failureBranch);
  const negativeReturn = adapter.indexOf("status: 'NOT_FOUND'", negativeInspection);
  const genericFailure = adapter.indexOf('failureCodeForStatus(response.status)', negativeReturn);
  assert.ok(
    payloadRead >= 0
    && failureBranch > payloadRead
    && negativeInspection > failureBranch
    && negativeReturn > negativeInspection
    && genericFailure > negativeReturn,
    'documented negative evidence must be inspected before generic HTTP failure mapping',
  );

  assert.match(negativeEvidence, /AUTHORITATIVE_RESERVATION_NOT_FOUND_SOURCE_CODE = '13061'/);
  assert.match(negativeEvidence, /AUTHORITATIVE_RESERVATION_NOT_FOUND_STATUS = 400/);
  assert.match(negativeEvidence, /AUTHORITATIVE_RESERVATION_NOT_FOUND_MESSAGE = 'RESERVATION WAS NOT FOUND IN SUPPLIER SYSTEM'/);
  assert.match(negativeEvidence, /httpStatus !== AUTHORITATIVE_RESERVATION_NOT_FOUND_STATUS/);
  assert.match(negativeEvidence, /!hasOwn\(root, 'ErrorResponse'\) \|\| hasOwn\(root, 'ReservationResponse'\)/);
  assert.match(negativeEvidence, /hasOwn\(errorResponse, 'Reservation'\) \|\| hasOwn\(errorResponse, 'traceID'\)/);
  assert.match(negativeEvidence, /errors\.length !== 1/);
  assert.match(negativeEvidence, /error\['@type'\] !== 'ErrorDetail'/);
  assert.match(negativeEvidence, /canonicalSourceCode\(error\.SourceCode\) !== AUTHORITATIVE_RESERVATION_NOT_FOUND_SOURCE_CODE/);
  assert.doesNotMatch(negativeEvidence, /typeof value === 'number'[\s\S]*String\(value\)/);
  assert.match(negativeEvidence, /error\.category !== 'VALIDATION'/);
  assert.match(negativeEvidence, /error\.Message !== AUTHORITATIVE_RESERVATION_NOT_FOUND_MESSAGE/);
  assert.match(negativeEvidence, /boundedProviderText\(error\.SourceID/);

  assert.match(focusedTest, /SourceCode: '13061'/);
  assert.match(focusedTest, /SourceCode: 13061/);
  assert.match(focusedTest, /legacyTraceResponse\.traceID/);
  assert.match(focusedTest, /\.Reservation = null/);
  assert.match(focusedTest, /SourceID: 'BK'/);
  assert.match(focusedTest, /\[\{\}, 404\]/);
  assert.match(focusedTest, /SourceCode: '13060'/);
  assert.match(focusedTest, /HOTEL OFFER NOT FOUND IN RESERVATION/);
  assert.match(focusedTest, /Reservation was not found in supplier system\./);
  assert.match(focusedTest, /ReservationResponse: null/);

  assert.match(docs, /13061/);
  assert.match(docs, /canonical newer-version message/i);
  assert.match(docs, /canonical decimal string/i);
  assert.match(docs, /legacy `traceID`/i);
  assert.match(docs, /supplier chain code/i);
  assert.match(docs, /generic HTTP `404`[\s\S]*non-authoritative/i);
  assert.match(docs, /supportsAuthoritativeNotFound = true/);
  assert.match(correlationDocs, /RESERVATION WAS NOT FOUND IN SUPPLIER SYSTEM/);
  assert.match(correlationDocs, /status\/category\/message\/envelope validation/i);
});
