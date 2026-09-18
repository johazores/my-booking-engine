import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const domain = await readFile(new URL('../src/server/bookings/rental-booking-effective-settlement-domain.ts', import.meta.url), 'utf8');
const service = await readFile(new URL('../src/server/bookings/rental-booking-effective-settlement-service.ts', import.meta.url), 'utf8');
const docs = await readFile(new URL('../docs/rental-booking-effective-settlement.md', import.meta.url), 'utf8');
const amendmentsDocs = await readFile(new URL('../docs/rental-booking-commercial-amendments.md', import.meta.url), 'utf8');
const rescheduleDocs = await readFile(new URL('../docs/rental-booking-reschedule-authority.md', import.meta.url), 'utf8');
const applyDocs = await readFile(new URL('../docs/rental-booking-commercial-amendment-apply.md', import.meta.url), 'utf8');

test('effective settlement derives one authoritative combined read model without rewriting original booking money', () => {
  assert.match(domain, /deriveRentalPaymentSettlement/);
  assert.match(domain, /deriveRentalBookingCommercialAmendmentSettlementState/);
  assert.match(domain, /effectiveAcceptedTotalMinor/);
  assert.match(domain, /cancellationRefundRemainingMinor/);
  assert.match(domain, /bookingPriceRefundRemainingMinor/);
  assert.match(domain, /amendmentChargeRefundRemainingMinor/);
  assert.match(domain, /amendment\.beforeTotalMinor !== input\.originalBookingTotalMinor/);
  assert.match(domain, /Applied rental commercial amendment arithmetic does not reconcile/);
});

test('applied refund is source-aware and applied charge remains a separate refund remainder', () => {
  assert.match(domain, /effectiveTransactions: BookingSettlementTransaction\[\]/);
  assert.match(domain, /sourceProviderReference: amendmentRefund\.sourceProviderReference/);
  assert.match(domain, /amendmentChargeRefundRemainingMinor: amendment\.deltaMinor/);
  assert.match(domain, /amendmentNetEffectMinor: -amendment\.deltaMinor/);
});

test('protected reader is tenant scoped, bounded, fingerprint checked, and permission checked', () => {
  assert.match(service, /assertUuidIdentifier\(input\.organizationId/);
  assert.match(service, /permission: 'booking:read'/);
  assert.match(service, /permission: 'payment:read'/);
  assert.match(service, /readRentalPaymentSettlementHistory/);
  assert.match(service, /status: 'APPLIED'/);
  assert.match(service, /take: 2/);
  assert.match(service, /take: 3/);
  assert.match(service, /buildRentalBookingCommercialAmendmentSettlementRequestFingerprint/);
  assert.match(service, /appliedReschedule/);
  assert.match(service, /does not retain matching terminal reschedule evidence/);
  assert.match(service, /where: \{ id: input\.bookingId, organizationId: input\.organizationId \}/);
  assert.match(service, /isolationLevel: 'RepeatableRead'/);
});

test('documentation keeps post-apply mutation blocked until an exact write contract exists', () => {
  assert.match(docs, /read-only/i);
  assert.match(docs, /not enable a post-apply refund/i);
  assert.match(docs, /not enable cancellation/i);
  assert.match(docs, /one applied price-changing amendment/i);
  assert.match(amendmentsDocs, /effective settlement read model/i);
  assert.match(amendmentsDocs, /post-apply refund writes and cancellation remain blocked/i);
  assert.match(rescheduleDocs, /final locked apply are implemented as backend contracts/i);
  assert.match(rescheduleDocs, /effective settlement read model/i);
  assert.match(applyDocs, /effective settlement \*\*read model is implemented\*\*/i);
  assert.match(applyDocs, /post-apply \*\*write\*\* contract/i);
});
