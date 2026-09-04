import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const service = readFileSync('src/server/payments/hospitality-repeated-commercial-amendment-adjustment-note-service.ts', 'utf8');
const orchestration = readFileSync('src/server/payments/hospitality-commercial-amendment-adjustment-orchestration-service.ts', 'utf8');
const route = readFileSync('app/api/bookings/hospitality/[booking-id]/commercial-amendments/[amendment-id]/adjustment-note/route.ts', 'utf8');

test('repeated issuance requires payment management and a serializable locked verified chain', () => {
  assert.match(service, /permission:\s*'payment:manage'/);
  assert.match(service, /selectVerifiedHospitalityCommercialAmendmentAdjustmentChainHeadForWrite/);
  assert.match(service, /chain\.priorAdjustmentNoteCount < 1 \|\| !chain\.head/);
  assert.match(service, /isolationLevel:\s*'Serializable'/);
});

test('cumulative readiness is derived from the complete verified predecessor chain and provider-neutral ledger', () => {
  assert.match(service, /deriveHospitalityCommercialAmendmentSettlementState/);
  assert.match(service, /priorAdjustmentNoteCount:\s*chain\.priorAdjustmentNoteCount/);
  assert.match(service, /priorAdjustments:\s*chain\.priorAdjustments/);
  assert.match(service, /readiness\.expectedSourceAdjustmentOrdinal !== chain\.expectedSourceAdjustmentOrdinal/);
  assert.match(service, /readiness\.predecessorAdjustmentNoteId !== chain\.head\.adjustmentNoteId/);
});

test('schema-version-3 evidence and relational predecessor authority use the exact verified chain head', () => {
  assert.match(service, /predecessorAdjustment:\s*\{/);
  assert.match(service, /adjustmentNoteId:\s*chain\.head\.adjustmentNoteId/);
  assert.match(service, /documentFingerprint:\s*chain\.head\.documentFingerprint/);
  assert.match(service, /afterPricingFingerprint:\s*chain\.head\.afterPricingFingerprint/);
  assert.match(service, /predecessorAdjustmentNoteId:\s*chain\.head\.adjustmentNoteId/);
  assert.match(service, /predecessorSourceAdjustmentOrdinal:\s*chain\.head\.sourceAdjustmentOrdinal/);
});

test('a repeated write must become the verified chain head before audit and commit', () => {
  const create = service.indexOf('hospitalityIssuedAdjustmentNote.create');
  const reload = service.indexOf('loadVerifiedHospitalityCommercialAmendmentAdjustmentChain', create);
  const audit = service.indexOf('auditEvent.create', reload);
  assert.ok(create >= 0 && reload > create && audit > reload);
  assert.match(service, /reloadedChain\.head\?\.adjustmentNoteId !== created\.id/);
  assert.match(service, /reloadedChain\.expectedSourceAdjustmentOrdinal !== sourceAdjustmentOrdinal \+ 1/);
});

test('the existing amendment API exposes first or repeated issuance only through server-derived orchestration', () => {
  assert.match(orchestration, /export async function issueHospitalityNextCommercialAmendmentAdjustmentNote/);
  assert.match(orchestration, /getHospitalityNextCommercialAmendmentAdjustmentNoteAvailability/);
  assert.match(orchestration, /availability\.commercialAmendmentId !== input\.commercialAmendmentId/);
  assert.match(orchestration, /availability\.sourceAdjustmentOrdinal === 1/);
  assert.match(orchestration, /issueHospitalityCommercialAmendmentAdjustmentNote/);
  assert.match(orchestration, /issueHospitalityRepeatedCommercialAmendmentAdjustmentNote/);
  assert.match(route, /issueHospitalityNextCommercialAmendmentAdjustmentNote/);
  assert.doesNotMatch(route, /issueHospitalityRepeatedCommercialAmendmentAdjustmentNote/);
});
