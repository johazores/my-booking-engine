import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const schema = readFileSync('prisma/rental-payment-transactions.prisma', 'utf8');
const rentalSchema = readFileSync('prisma/rental-inventory.prisma', 'utf8');
const migration = readFileSync('prisma/migrations/20260915235000_rental_payment_foundation/migration.sql', 'utf8');
const domain = readFileSync('src/server/payments/rental-payment-domain.ts', 'utf8');
const history = readFileSync('src/server/payments/rental-payment-history.ts', 'utf8');
const service = readFileSync('src/server/payments/rental-payment-service.ts', 'utf8');
const cancellation = readFileSync('src/server/bookings/rental-booking-cancellation-service.ts', 'utf8');
const paymentRoute = readFileSync('app/api/inventory/rentals/bookings/[booking-id]/payments/manual/route.ts', 'utf8');
const refundRoute = readFileSync('app/api/inventory/rentals/bookings/[booking-id]/payments/refunds/route.ts', 'utf8');
const detail = readFileSync('app/inventory/rentals/bookings/[booking-id]/page.tsx', 'utf8');
const panel = readFileSync('src/components/rental-booking-payment-panel.tsx', 'utf8');
const docs = readFileSync('docs/rental-payment-foundation.md', 'utf8');
const databaseRunner = readFileSync('scripts/run-database-tests.mjs', 'utf8');
const integration = readFileSync('src/server/payments/rental-payment.integration.ts', 'utf8');

test('rental payment persistence remains tenant-owned and refund-source attributed', () => {
  assert.match(schema, /model RentalPaymentTransaction/);
  assert.match(schema, /bookingId\s+String\s+@db\.Uuid/);
  assert.match(schema, /sourceProviderReference\s+String\?/);
  assert.match(schema, /@@unique\(\[organizationId, idempotencyKey\]/);
  assert.match(schema, /@@unique\(\[organizationId, providerCode, providerReference\], map: "rental_payment_transactions_org_provider_reference_key"\)/);
  assert.match(schema, /booking\s+RentalBooking\s+@relation\(fields: \[bookingId, organizationId\]/);
  assert.match(rentalSchema, /paymentTransactions\s+RentalPaymentTransaction\[\]/);
  assert.match(migration, /FOREIGN KEY \("bookingId", "organizationId"\)/);
  assert.match(migration, /REFERENCES "rental_bookings"\("id", "organizationId"\)/);
  assert.match(migration, /"kind" = 'REFUND'.*"sourceProviderReference" IS NOT NULL/s);
  assert.match(migration, /rental refund exceeds its settled source payment/);
  assert.match(migration, /rental payment transaction evidence is append-only/);
});

test('manual rental settlement keeps full-value funding and adds source-bound partial refund authority', () => {
  assert.match(service, /permission: 'payment:manage'/);
  assert.match(service, /ManualPaymentProvider/);
  assert.match(service, /buildRentalPaymentIdempotencyKey/);
  assert.match(service, /rentalBookingLockKey\(input\.organizationId, input\.bookingId\)/);
  assert.match(service, /where: \{ id: input\.bookingId, organizationId: input\.organizationId \}/);
  assert.match(service, /readRentalPaymentSettlementHistory/);
  assert.match(service, /recordOfflinePayment/);
  assert.match(service, /money: \{ currency: booking\.currency, amountMinor: booking\.totalMinor \}/);
  assert.match(service, /parseOptionalRentalRefundAmount/);
  assert.match(service, /parseMoneyMajorToMinor\(normalized, currency\)/);
  assert.match(service, /requestedAmountMinor,/);
  assert.match(service, /deriveBookingRefundExecutionPlan/);
  assert.match(service, /sourceProviderReference: plan\.sourceProviderReference/);
  assert.match(service, /providerResult\.money\.amountMinor !== plan\.amountMinor/);
  assert.match(service, /existing\.amountMinor !== requestedAmountMinor/);
  assert.doesNotMatch(service, /settlement\.paymentState !== 'REFUNDED'[\s\S]*Rental refund idempotent replay/);
  assert.match(service, /classifyRentalBookingWriteError/);
  assert.match(service, /retryUniqueConflict: true/);
  assert.match(service, /isolationLevel: 'Serializable'/);
  assert.match(domain, /transaction\.providerCode !== 'manual'/);
  assert.match(domain, /transaction\.kind !== 'OFFLINE_PAYMENT' && transaction\.kind !== 'REFUND'/);
});

test('complete settlement history stays bounded and cancellation still requires zero net settlement', () => {
  assert.match(history, /RENTAL_PAYMENT_SETTLEMENT_PAGE_SIZE = 100/);
  assert.match(history, /RENTAL_PAYMENT_SETTLEMENT_MAX_TRANSACTIONS = 1_000/);
  assert.match(history, /where: \{ organizationId: input\.organizationId, bookingId: input\.bookingId \}/);
  assert.match(history, /reconciliation safety limit/);
  assert.match(cancellation, /readRentalPaymentSettlementHistory/);
  assert.match(cancellation, /deriveRentalPaymentSettlement/);
  assert.match(cancellation, /paymentSettlement\.netSettledMinor !== 0n/);
  assert.match(migration, /sf_guard_rental_booking_cancellation_payment_settlement/);
  assert.match(migration, /net_settled_minor <> 0/);
});

test('staff routes safely parse form bodies and expose only the refund amount as browser money input', () => {
  for (const route of [paymentRoute, refundRoute]) {
    assert.match(route, /prepareInventoryMutationRequest/);
    assert.match(route, /readInventoryFormData\(request\)/);
    assert.match(route, /if \(!formData\)/);
    assert.match(route, /organizationId: organization\.id/);
    assert.match(route, /actorUserId: session\.user\.id/);
    assert.doesNotMatch(route, /formField\(formData, 'organizationId'\)/);
    assert.doesNotMatch(route, /formField\(formData, 'actorUserId'\)/);
    assert.doesNotMatch(route, /formField\(formData, 'idempotency/);
  }
  assert.match(paymentRoute, /reference: formField\(formData, 'reference'\)/);
  assert.doesNotMatch(paymentRoute, /formField\(formData, 'amount'\)/);
  assert.match(refundRoute, /reference: formField\(formData, 'reference'\)/);
  assert.match(refundRoute, /amount: formField\(formData, 'amount'\)/);
  assert.match(detail, /listRentalBookingPaymentTransactions/);
  assert.match(detail, /paymentData\.settlement\.netSettledMinor === 0n/);
  assert.match(panel, /Refund amount \(\{bookingCurrency\}\)/);
  assert.match(panel, /defaultValue=\{moneyMinorToMajorString\(refundableAmount, bookingCurrency\)\}/);
  assert.match(panel, /Partial refunds remain settled and continue blocking cancellation/);
  assert.match(panel, />Record refund</);
});

test('guarded PostgreSQL coverage includes partial refund replay and zero-net cancellation safety', () => {
  assert.match(databaseRunner, /src\/server\/payments\/rental-payment\.integration\.ts/);
  assert.match(integration, /partialRefundMinor/);
  assert.match(integration, /partialRefundAmount/);
  assert.match(integration, /paymentState, 'PARTIALLY_REFUNDED'/);
  assert.match(integration, /partialRefundReplay/);
  assert.match(integration, /partialReplayAfterFullRefund/);
  assert.match(integration, /partialRefundReplayAfterCancellation/);
  assert.match(integration, /finalRefund/);
  assert.match(integration, /paymentState, 'REFUNDED'/);
  assert.match(integration, /cancelRentalBooking/);
  assert.match(integration, /rentalPaymentTransaction\.update/);
});

test('documentation keeps the expanded refund capability and unsupported payment boundaries explicit', () => {
  assert.match(docs, /refunds may be partial or may refund the full remaining source balance/i);
  assert.match(docs, /browser never chooses the tenant, actor, provider, settlement source/i);
  assert.match(docs, /partial refunds remain financially settled/i);
  assert.match(docs, /safe inventory form parser/i);
  assert.match(docs, /does not implement deposits, card authorization, Stripe rental checkout/i);
  assert.match(docs, /split-tender or partial booking-price payments/i);
  assert.match(docs, /No placeholder route or fake provider action/i);
  assert.match(docs, /GitHub Actions are not required or used/);
});
