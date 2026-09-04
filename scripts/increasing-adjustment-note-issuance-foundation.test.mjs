import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const writer = readFileSync('src/server/payments/hospitality-commercial-amendment-increasing-adjustment-note-service.ts', 'utf8');
const productOrchestration = readFileSync('src/server/payments/hospitality-commercial-amendment-adjustment-product-service.ts', 'utf8');
const route = readFileSync('app/api/bookings/hospitality/[booking-id]/commercial-amendments/[amendment-id]/adjustment-note/route.ts', 'utf8');

test('increasing adjustment-note writer is tenant-authorized and serializable', () => {
  assert.match(writer, /permission:\s*'payment:manage'/);
  assert.match(writer, /organizationId:\s*input\.organizationId[\s\S]*bookingId:\s*input\.bookingId/);
  assert.match(writer, /isolationLevel:\s*'Serializable'/);
  assert.match(writer, /for \(let attempt = 0; attempt < 3; attempt \+= 1\)/);
  assert.match(writer, /code === 'P2002' \|\| code === 'P2034'/);
});

test('writer derives immutable schema-v4 money and number authority server-side', () => {
  assert.match(writer, /createHospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteSnapshot/);
  assert.match(writer, /hospitalityInvoiceNumberSequence\.upsert/);
  assert.match(writer, /jurisdictionCode:\s*'AU'/);
  assert.match(writer, /documentType:\s*'ADJUSTMENT_NOTE'/);
  assert.match(writer, /adjustmentType:\s*'INCREASING'/);
  assert.match(writer, /decreaseSubtotalMinor:\s*0n/);
  assert.match(writer, /decreaseTaxMinor:\s*0n/);
  assert.match(writer, /decreaseTotalMinor:\s*0n/);
  assert.match(writer, /increaseSubtotalMinor:\s*BigInt\(snapshot\.increaseSubtotalMinor\)/);
  assert.match(writer, /increaseTaxMinor:\s*BigInt\(snapshot\.increaseTaxMinor\)/);
  assert.match(writer, /increaseTotalMinor:\s*BigInt\(snapshot\.increaseTotalMinor\)/);
  assert.match(writer, /validatePersistedIncreasingAdjustmentNote\(created\)/);
});

test('writer fails closed on ambiguous same-baseline amendments and revalidates settlement', () => {
  assert.match(writer, /competingBaselineAmendmentCount/);
  assert.match(writer, /direction:\s*\{ in: \['REFUND', 'ADDITIONAL_CHARGE'\] \}/);
  assert.match(writer, /deriveHospitalityCommercialAmendmentSettlementState/);
  assert.match(writer, /assessAustralianCommercialAmendmentIncreasingAdjustmentReadiness/);
  assert.match(writer, /priorAdjustmentNoteCount/);
});

test('writer remains idempotent by tenant-owned commercial amendment and records a safe audit', () => {
  assert.match(writer, /organizationId:\s*input\.organizationId,[\s\S]*commercialAmendmentId:\s*input\.commercialAmendmentId/);
  assert.match(writer, /parseHospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteSnapshot/);
  assert.match(writer, /action:\s*'payment\.adjustment-note\.issued'/);
  assert.match(writer, /increaseTotalMinor:\s*snapshot\.increaseTotalMinor/);
  assert.doesNotMatch(writer, /providerReference[^\n]*afterData/);
});

test('increasing writer is reachable only through server-derived product orchestration', () => {
  assert.match(productOrchestration, /issueHospitalityCommercialAmendmentIncreasingAdjustmentNote/);
  assert.match(productOrchestration, /availability\.adjustmentType === 'INCREASING'/);
  assert.match(productOrchestration, /verifyHospitalityCommercialAmendmentIncreasingAdjustmentRows/);
  assert.match(route, /hospitality-commercial-amendment-adjustment-product-service/);
  assert.match(route, /issueHospitalityNextCommercialAmendmentAdjustmentNote/);
  assert.doesNotMatch(route, /issueHospitalityCommercialAmendmentIncreasingAdjustmentNote/);
});
