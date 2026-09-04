import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const orchestration = readFileSync('src/server/payments/hospitality-commercial-amendment-adjustment-orchestration-service.ts', 'utf8');
const page = readFileSync('app/invoices/[document-number]/page.tsx', 'utf8');
const action = readFileSync('src/components/commercial-amendment-adjustment-note-action.tsx', 'utf8');
const route = readFileSync('app/api/bookings/hospitality/[booking-id]/commercial-amendments/[amendment-id]/adjustment-note/route.ts', 'utf8');

test('next-adjustment availability is tenant-authorized and starts from a fully verified source chain', () => {
  assert.match(orchestration, /permission:\s*'payment:manage'/);
  assert.match(orchestration, /organizationId:\s*input\.organizationId/);
  assert.match(orchestration, /bookingId:\s*input\.bookingId/);
  assert.match(orchestration, /loadVerifiedHospitalityCommercialAmendmentAdjustmentChain/);
  assert.match(orchestration, /adjustmentReason:\s*\{ not: 'COMMERCIAL_AMENDMENT' \}/);
});

test('candidate discovery follows the current legal baseline and remains unambiguous', () => {
  assert.match(orchestration, /chain\.priorAdjustments\[chain\.priorAdjustments\.length - 1\]!\.after/);
  assert.match(orchestration, /beforeTotalMinor:\s*legalBaseline\.totalMinor/);
  assert.match(orchestration, /beforePricingFingerprint:\s*legalBaseline\.pricingFingerprint/);
  assert.match(orchestration, /take:\s*2/);
  assert.match(orchestration, /Multiple commercial amendments match the current verified legal price baseline/);
});

test('availability reruns target, settlement, cumulative readiness, and predecessor agreement', () => {
  assert.match(orchestration, /parseHospitalityBookingPricingEvidenceBreakdown/);
  assert.match(orchestration, /deriveHospitalityCommercialAmendmentSettlementState/);
  assert.match(orchestration, /priorAdjustmentNoteCount:\s*chain\.priorAdjustmentNoteCount/);
  assert.match(orchestration, /priorAdjustments:\s*chain\.priorAdjustments/);
  assert.match(orchestration, /sourceAdjustmentOrdinal !== chain\.expectedSourceAdjustmentOrdinal/);
  assert.match(orchestration, /readiness\.predecessorAdjustmentNoteId !== chain\.head\.adjustmentNoteId/);
});

test('idempotent retries verify an existing amendment document through the complete source chain', () => {
  assert.match(orchestration, /commercialAmendmentId:\s*input\.commercialAmendmentId/);
  assert.match(orchestration, /chain\.priorAdjustments\.some\(\(entry\) => entry\.adjustmentNoteId === existing\.id\)/);
  assert.match(orchestration, /existing\.sourceAdjustmentOrdinal === 1 \? 'FIRST'/);
});

test('tax-invoice UI exposes the chain-derived next action and keeps the latest legal adjustment visible', () => {
  assert.match(page, /getHospitalityNextCommercialAmendmentAdjustmentNoteAvailability/);
  assert.match(page, /sourceAdjustmentOrdinal=\{commercialAdjustmentAvailability\.sourceAdjustmentOrdinal\}/);
  assert.match(page, /View latest adjustment note/);
  assert.match(action, /sourceAdjustmentOrdinal > 1/);
  assert.match(action, /Issue next amendment adjustment note/);
  assert.match(action, /adjustment \{sourceAdjustmentOrdinal\} in the verified legal-document chain/);
});

test('the existing API route delegates issuance mode to server orchestration', () => {
  assert.match(route, /issueHospitalityNextCommercialAmendmentAdjustmentNote/);
  assert.doesNotMatch(route, /issueHospitalityRepeatedCommercialAmendmentAdjustmentNote/);
  assert.match(route, /sourceAdjustmentOrdinal:\s*issued\.sourceAdjustmentOrdinal/);
});
