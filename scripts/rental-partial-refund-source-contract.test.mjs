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

test('staff routes fail closed on malformed form bodies while payment and refund amounts remain non-authoritative requests', () => {
  for (const route of [paymentRoute, refundRoute]) {
    assert.match(route, /readInventoryFormData\(request\)/);
    assert.match(route, /if \(!formData\)/);
    assert.match(route, /organizationId: organization\.id/);
    assert.match(route, /actorUserId: session\.user\.id/);
    assert.match(route, /formField\(formData, 'amount'\)/);
    assert.doesNotMatch(route, /formField\(formData, 'organizationId'\)/);
    assert.doesNotMatch(route, /formField\(formData, 'sourceProviderReference'\)/);
  }
});

test('staff UI defaults refunds to the next source boundary and does not imply online settlement', () => {
  assert.match(panel, /Refund amount \(\{bookingCurrency\}\)/);
  assert.match(panel, /inputMode="decimal"/);
  assert.match(panel, /defaultValue=\{moneyMinorToMajorString\(nextRefundableSourceAmount, bookingCurrency\)\}/);
  assert.match(panel, /next server-selected payment source/);
  assert.match(panel, /Total refundable booking balance/);
  assert.match(panel, /Partial refunds remain settled and continue blocking cancellation/);
  assert.match(panel, /mixed-provider settlement/);
  assert.match(panel, /customer self-service are not enabled/);
});

test('guarded database scenario covers partial refund, replay, replacement funding, full refund, and cancellation ordering', () => {
  assert.match(integration, /partialRefundMinor/);
  assert.match(integration, /paymentState, 'PARTIALLY_REFUNDED'/);
  assert.match(integration, /replacementPayment/);
  assert.match(integration, /paymentState, 'REFUNDED'/);
  assert.match(integration, /partialRefundReplayAfterCancellation/);
  assert.match(integration, /cancelRentalBooking/);
});

test('documentation clearly separates partial refund capability from manual partial funding and unsupported provider workflows', () => {
  assert.match(docs, /Both payments and refunds may be partial/i);
  assert.match(docs, /Partial refunds remain financially settled/i);
  assert.match(docs, /mixed-provider settlement/i);
  assert.match(docs, /online checkout workflow/i);
  assert.match(requestDocs, /source and exact minor-unit amount are bound/i);
  assert.match(requestDocs, /partial refund remains replayable while the booking is still `PARTIALLY_REFUNDED`/);
  assert.match(requestDocs, /does not add Stripe rental checkout/i);
});
