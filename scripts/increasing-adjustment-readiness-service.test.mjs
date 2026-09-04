import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../src/server/payments/hospitality-commercial-amendment-increasing-adjustment-readiness-service.ts', import.meta.url),
  'utf8',
);

test('increasing adjustment readiness requires payment manage permission', () => {
  assert.match(source, /permission:\s*'payment:manage'/);
});

test('all legal evidence lookups remain tenant and booking scoped', () => {
  assert.match(source, /hospitalityIssuedInvoice\.findFirst\([\s\S]*organizationId:\s*input\.organizationId[\s\S]*bookingId:\s*input\.bookingId[\s\S]*jurisdictionCode:\s*'AU'[\s\S]*documentType:\s*'TAX_INVOICE'/);
  assert.match(source, /hospitalityBookingCommercialAmendment\.findFirst\([\s\S]*id:\s*input\.commercialAmendmentId[\s\S]*organizationId:\s*input\.organizationId[\s\S]*bookingId:\s*input\.bookingId/);
  assert.match(source, /hospitalityBookingPricingEvidence\.findMany\([\s\S]*organizationId:\s*input\.organizationId[\s\S]*bookingId:\s*input\.bookingId[\s\S]*commercialAmendmentId:\s*amendment\.id[\s\S]*source:\s*'COMMERCIAL_AMENDMENT_TARGET'/);
  assert.match(source, /hospitalityIssuedAdjustmentNote\.count\([\s\S]*organizationId:\s*input\.organizationId[\s\S]*bookingId:\s*input\.bookingId[\s\S]*sourceInvoiceId:\s*sourceInvoice\.id/);
  assert.match(source, /paymentTransaction\.findMany\([\s\S]*organizationId:\s*input\.organizationId[\s\S]*bookingId:\s*input\.bookingId/);
});

test('readiness derives settlement from persisted provider-neutral payment history inside a serializable transaction', () => {
  assert.match(source, /deriveHospitalityCommercialAmendmentSettlementState\(/);
  assert.match(source, /isolationLevel:\s*'Serializable'/);
  assert.doesNotMatch(source, /providerReference:\s*input\./);
  assert.doesNotMatch(source, /amountMinor:\s*input\./);
});
