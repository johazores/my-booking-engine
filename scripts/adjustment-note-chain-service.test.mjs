import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const service = readFileSync(
  new URL('../src/server/payments/hospitality-commercial-amendment-adjustment-chain-service.ts', import.meta.url),
  'utf8',
);

test('chain loader keeps every persistence lookup tenant, booking, and source scoped', () => {
  assert.match(service, /hospitalityIssuedInvoice\.findFirst\([\s\S]*id: input\.sourceInvoiceId[\s\S]*organizationId: input\.organizationId[\s\S]*bookingId: input\.bookingId/);
  assert.match(service, /hospitalityIssuedAdjustmentNote\.findMany\([\s\S]*organizationId: input\.organizationId[\s\S]*bookingId: input\.bookingId[\s\S]*sourceInvoiceId: input\.sourceInvoiceId/);
  assert.match(service, /hospitalityBookingCommercialAmendment\.findMany\([\s\S]*organizationId: input\.organizationId[\s\S]*bookingId: input\.bookingId/);
  assert.match(service, /hospitalityBookingPricingEvidence\.findMany\([\s\S]*organizationId: input\.organizationId[\s\S]*bookingId: input\.bookingId[\s\S]*source: 'COMMERCIAL_AMENDMENT_TARGET'/);
  assert.doesNotMatch(service, /\bdb\./);
});

test('write-head selection serializes one tenant booking source-invoice chain before verification', () => {
  assert.match(service, /selectVerifiedHospitalityCommercialAmendmentAdjustmentChainHeadForWrite/);
  assert.match(service, /pg_advisory_xact_lock\(hashtextextended\(\$\{chainLockKey\(input\)\}, 0\)\)/);
  assert.match(service, /return loadVerifiedHospitalityCommercialAmendmentAdjustmentChain\(input\);/);
});

test('chain loading is bounded and fails closed on mixed legal adjustment reasons', () => {
  assert.match(service, /HOSPITALITY_COMMERCIAL_AMENDMENT_ADJUSTMENT_CHAIN_LIMIT = 5_000/);
  assert.match(service, /take: HOSPITALITY_COMMERCIAL_AMENDMENT_ADJUSTMENT_CHAIN_LIMIT \+ 1/);
  assert.match(service, /rows\.some\(\(row\) => row\.adjustmentReason !== 'COMMERCIAL_AMENDMENT'\)/);
});
