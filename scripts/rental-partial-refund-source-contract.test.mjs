import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const service = readFileSync('src/server/payments/rental-payment-service.ts', 'utf8');
const paymentRoute = readFileSync('app/api/inventory/rentals/bookings/[booking-id]/payments/manual/route.ts', 'utf8');
const refundRoute = readFileSync('app/api/inventory/rentals/bookings/[booking-id]/payments/refunds/route.ts', 'utf8');
const panel = readFileSync('src/components/rental-booking-payment-panel.tsx', 'utf8');
const integration = readFileSync('src/server/payments/rental-payment.integration.ts', 'utf8');
const docs = readFileSync('docs/rental-payment-foundation.md', 'utf8');
const requestDocs = readFileSync('docs/rental-payment-request-evidence.md', 'utf8');

test('partial refund authority is currency-aware, server-planned, source-bound, and fingerprinted', () => {
  assert.match(service, /parseMoneyMajorToMinor\(normalized, currency\)/);
  assert.match(service, /Rental refund amount must be greater than zero/);
  assert.match(service, /requestedAmountMinor,/);
  assert.match(service, /deriveBookingRefundExecutionPlan/);
  assert.match(service, /sourceProviderReference: plan\.sourceProviderReference/);
  assert.match(service, /amountMinor: plan\.amountMinor/);
  assert.match(service, /providerResult\.money\.amountMinor !== plan\.amountMinor/);
  assert.match(service, /requestFingerprint !== expectedRequestFingerprint/);
  assert.match(service, /permission: 'payment:manage'/);
  assert.match(service, /where: \{ id: input\.bookingId, organizationId: input\.organizationId \}/);
});

test('partial refund replay remains exact without requiring the whole booking to be fully refunded', () => {
  assert.match(service, /requestedAmountMinor !== null && existing\.amountMinor !== requestedAmountMinor/);
  assert.match(service, /const sourceExists = history\.some/);
  assert.match(service, /if \(!sourceExists \|\| !settlement\.reconciled\)/);
  assert.doesNotMatch(service, /settlement\.paymentState !== 'REFUNDED'[\s\S]{0,300}idempotent replay/);
  assert.match(integration, /partialRefundReplay/);
  assert.match(integration, /partialReplayAfterFullRefund/);
  assert.match(integration, /partialRefundReplayAfterCancellation/);
  assert.match(integration, /different durable settlement evidence/i);
});

test('staff routes fail closed on malformed form bodies and only refund accepts browser money input', () => {
  for (const route of [paymentRoute, refundRoute]) {
    assert.match(route, /readInventoryFormData\(request\)/);
    assert.match(route, /if \(!formData\)/);
    assert.match(route, /organizationId: organization\.id/);
    assert.match(route, /actorUserId: session\.user\.id/);
  }
  assert.doesNotMatch(paymentRoute, /formField\(formData, 'amount'\)/);
  assert.match(refundRoute, /amount: formField\(formData, 'amount'\)/);
  assert.doesNotMatch(refundRoute, /formField\(formData, 'organizationId'\)/);
  assert.doesNotMatch(refundRoute, /formField\(formData, 'sourceProviderReference'\)/);
});

test('staff UI exposes explicit bounded refund amount without implying online settlement', () => {
  assert.match(panel, /Refund amount \(\{bookingCurrency\}\)/);
  assert.match(panel, /inputMode="decimal"/);
  assert.match(panel, /defaultValue=\{moneyMinorToMajorString\(refundableAmount, bookingCurrency\)\}/);
  assert.match(panel, /current refundable balance/);
  assert.match(panel, /Partial refunds remain settled and continue blocking cancellation/);
  assert.match(panel, /split-tender payments/);
  assert.match(panel, /customer self-service are not enabled/);
});

test('guarded database scenario covers partial refund, replay, later full refund, and cancellation ordering', () => {
  assert.match(integration, /partialRefundMinor/);
  assert.match(integration, /paymentState, 'PARTIALLY_REFUNDED'/);
  assert.match(integration, /cancelRentalBooking/);
  assert.match(integration, /finalRefund/);
  assert.match(integration, /paymentState, 'REFUNDED'/);
  assert.match(integration, /partialRefundReplayAfterCancellation/);
});

test('documentation clearly separates partial refund capability from unsupported funding and provider workflows', () => {
  assert.match(docs, /refunds may be partial or may refund the full remaining source balance/i);
  assert.match(docs, /partial refunds remain financially settled/i);
  assert.match(docs, /split-tender or partial booking-price payments/i);
  assert.match(docs, /online checkout/i);
  assert.match(requestDocs, /source and exact minor-unit amount are bound/i);
  assert.match(requestDocs, /partial refund remains replayable while the booking is still `PARTIALLY_REFUNDED`/);
  assert.match(requestDocs, /does not add Stripe rental checkout/i);
});
