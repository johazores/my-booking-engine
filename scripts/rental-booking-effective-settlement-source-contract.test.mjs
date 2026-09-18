import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const domain = await readFile(new URL('../src/server/bookings/rental-booking-effective-settlement-domain.ts', import.meta.url), 'utf8');
const service = await readFile(new URL('../src/server/bookings/rental-booking-effective-settlement-service.ts', import.meta.url), 'utf8');
const history = await readFile(new URL('../src/server/bookings/rental-booking-effective-refund-history.ts', import.meta.url), 'utf8');
const docs = await readFile(new URL('../docs/rental-booking-effective-settlement.md', import.meta.url), 'utf8');

test('effective settlement reconciles original, amendment, and post-apply refund evidence', () => {
  assert.match(domain, /deriveRentalPaymentSettlement/);
  assert.match(domain, /deriveRentalBookingCommercialAmendmentSettlementState/);
  assert.match(domain, /postApplyRefunds/);
  assert.match(domain, /nextRefundSource/);
  assert.match(domain, /sourceLedger: 'COMMERCIAL_AMENDMENT'/);
  assert.match(domain, /sourceLedger: 'BOOKING_PRICE'/);
  assert.match(domain, /amendmentChargeRefundRemainingMinor/);
  assert.match(domain, /bookingPriceRefundRemainingMinor/);
  assert.match(domain, /Applied rental commercial amendment arithmetic does not reconcile/);
});

test('applied increase refunds amendment charge first and decrease consumes original source', () => {
  assert.match(domain, /amendmentChargeRefundRemainingMinor > 0n/);
  assert.match(domain, /providerReference: amendmentPayment\.providerReference/);
  assert.match(domain, /sourceProviderReference: amendmentRefund\.sourceProviderReference/);
  assert.match(domain, /An applied rental decrease cannot retain amendment-charge refund evidence/);
});

test('protected reader remains tenant scoped, bounded, fingerprint checked, and permission checked', () => {
  assert.match(service, /assertUuidIdentifier\(input\.organizationId/);
  assert.match(service, /permission: 'booking:read'/);
  assert.match(service, /permission: 'payment:read'/);
  assert.match(service, /readRentalPaymentSettlementHistory/);
  assert.match(service, /readRentalBookingEffectiveRefundHistory/);
  assert.match(service, /status: 'APPLIED'/);
  assert.match(service, /take: 2/);
  assert.match(service, /take: 3/);
  assert.match(service, /buildRentalBookingCommercialAmendmentSettlementRequestFingerprint/);
  assert.match(service, /where: \{ id: input\.bookingId, organizationId: input\.organizationId \}/);
  assert.match(service, /isolationLevel: 'RepeatableRead'/);

  assert.match(history, /RENTAL_BOOKING_EFFECTIVE_REFUND_PAGE_SIZE = 100/);
  assert.match(history, /RENTAL_BOOKING_EFFECTIVE_REFUND_MAX_TRANSACTIONS = 1_000/);
  assert.match(history, /buildRentalBookingEffectiveRefundIdempotencyKey/);
  assert.match(history, /buildRentalBookingEffectiveRefundRequestFingerprint/);
  assert.match(history, /row\.createdAt\.getTime\(\) < input\.appliedAt\.getTime\(\)/);
});

test('documentation states implemented post-apply refunds and retains fail-closed cancellation boundary', () => {
  assert.match(docs, /post-apply manual refund writer/i);
  assert.match(docs, /do not accept a client-selected payment source/i);
  assert.match(docs, /cancellation after an applied commercial amendment remains blocked/i);
  assert.match(docs, /one applied price-changing amendment/i);
});
