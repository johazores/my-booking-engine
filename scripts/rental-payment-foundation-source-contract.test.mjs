import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const schema = readFileSync('prisma/rental-payment-transactions.prisma', 'utf8');
const rentalSchema = readFileSync('prisma/rental-inventory.prisma', 'utf8');
const foundationMigration = readFileSync('prisma/migrations/20260915235000_rental_payment_foundation/migration.sql', 'utf8');
const partialPaymentMigration = readFileSync('prisma/migrations/20260917180000_rental_partial_manual_payments/migration.sql', 'utf8');
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

test('rental payment persistence remains tenant-owned, append-only, and refund-source attributed', () => {
  assert.match(schema, /model RentalPaymentTransaction/);
  assert.match(schema, /bookingId\s+String\s+@db\.Uuid/);
  assert.match(schema, /sourceProviderReference\s+String\?/);
  assert.match(schema, /@@unique\(\[organizationId, idempotencyKey\]/);
  assert.match(schema, /@@unique\(\[organizationId, providerCode, providerReference\]/);
  assert.match(schema, /booking\s+RentalBooking\s+@relation\(fields: \[bookingId, organizationId\]/);
  assert.match(rentalSchema, /paymentTransactions\s+RentalPaymentTransaction\[\]/);
  assert.match(foundationMigration, /FOREIGN KEY \("bookingId", "organizationId"\)/);
  assert.match(foundationMigration, /rental refund exceeds its settled source payment/);
  assert.match(foundationMigration, /rental payment transaction evidence is append-only/);
});

test('manual rental settlement accepts bounded partial funding and source-bound partial refunds', () => {
  assert.match(service, /permission: 'payment:manage'/);
  assert.match(service, /ManualPaymentProvider/);
  assert.match(service, /assertRentalManualReferenceUnused/);
  assert.match(service, /sf:rental-manual-reference:/);
  assert.match(service, /rentalDamageSettlementTransaction\.findFirst/);
  assert.match(service, /rentalSecurityBondTransaction\.findFirst/);
  assert.match(service, /rentalLateReturnSettlementTransaction\.findFirst/);
  assert.match(service, /parseOptionalRentalPaymentAmount/);
  assert.match(service, /const requestedAmountMinor = parseOptionalRentalPaymentAmount\(input\.amount, booking\.currency\)/);
  assert.match(service, /const paymentAmountMinor = requestedAmountMinor \?\? settlement\.outstandingMinor/);
  assert.match(service, /paymentAmountMinor > settlement\.outstandingMinor/);
  assert.match(service, /money: \{ currency: booking\.currency, amountMinor: paymentAmountMinor \}/);
  assert.match(service, /parseOptionalRentalRefundAmount/);
  assert.match(service, /deriveBookingRefundExecutionPlan/);
  assert.match(service, /settlement\.paymentState === 'PARTIALLY_PAID'/);
  assert.match(service, /sourceProviderReference: plan\.sourceProviderReference/);
  assert.match(service, /providerResult\.money\.amountMinor !== plan\.amountMinor/);
  assert.match(service, /classifyRentalBookingWriteError/);
  assert.match(service, /isolationLevel: 'Serializable'/);
  assert.match(domain, /'PARTIALLY_PAID'/);
  assert.match(domain, /outstandingMinor/);
  assert.match(domain, /nextRefundableSourceMinor/);
  assert.match(domain, /transaction\.providerCode !== 'manual'/);
});

test('PostgreSQL caps each new manual payment at the current net outstanding balance', () => {
  assert.match(partialPaymentMigration, /CREATE OR REPLACE FUNCTION sf_guard_rental_payment_transaction_insert/);
  assert.match(partialPaymentMigration, /net_settled_minor BIGINT/);
  assert.match(partialPaymentMigration, /WHEN payment\."kind" = 'OFFLINE_PAYMENT' THEN payment\."amountMinor"/);
  assert.match(partialPaymentMigration, /WHEN payment\."kind" = 'REFUND' THEN -payment\."amountMinor"/);
  assert.match(partialPaymentMigration, /net_settled_minor \+ NEW\."amountMinor" > parent_booking\."totalMinor"/);
  assert.match(partialPaymentMigration, /exceeds the outstanding authoritative booking balance/);
  assert.doesNotMatch(partialPaymentMigration, /already has successful settlement evidence/);
  assert.match(partialPaymentMigration, /rental refund exceeds its settled source payment/);
});

test('complete settlement history stays bounded and cancellation still requires zero net settlement', () => {
  assert.match(history, /RENTAL_PAYMENT_SETTLEMENT_PAGE_SIZE = 100/);
  assert.match(history, /RENTAL_PAYMENT_SETTLEMENT_MAX_TRANSACTIONS = 1_000/);
  assert.match(history, /where: \{ organizationId: input\.organizationId, bookingId: input\.bookingId \}/);
  assert.match(cancellation, /readRentalPaymentSettlementHistory/);
  assert.match(cancellation, /deriveRentalPaymentSettlement/);
  assert.match(cancellation, /paymentSettlement\.netSettledMinor !== 0n/);
  assert.match(foundationMigration, /sf_guard_rental_booking_cancellation_payment_settlement/);
  assert.match(foundationMigration, /net_settled_minor <> 0/);
});

test('staff routes safely parse explicit payment and refund amounts without accepting tenant authority', () => {
  for (const route of [paymentRoute, refundRoute]) {
    assert.match(route, /prepareInventoryMutationRequest/);
    assert.match(route, /readInventoryFormData\(request\)/);
    assert.match(route, /if \(!formData\)/);
    assert.match(route, /organizationId: organization\.id/);
    assert.match(route, /actorUserId: session\.user\.id/);
    assert.doesNotMatch(route, /formField\(formData, 'organizationId'\)/);
    assert.doesNotMatch(route, /formField\(formData, 'actorUserId'\)/);
    assert.doesNotMatch(route, /formField\(formData, 'idempotency/);
    assert.match(route, /formField\(formData, 'amount'\)/);
  }
  assert.match(paymentRoute, /reference: formField\(formData, 'reference'\)/);
  assert.match(paymentRoute, /amount,/);
  assert.match(refundRoute, /reference: formField\(formData, 'reference'\)/);
  assert.match(refundRoute, /amount: formField\(formData, 'amount'\)/);
  assert.match(detail, /listRentalBookingPaymentTransactions/);
  assert.match(detail, /paymentData\.settlement\.netSettledMinor === 0n/);
  assert.match(panel, /Payment amount \(\{bookingCurrency\}\)/);
  assert.match(panel, /defaultValue=\{moneyMinorToMajorString\(outstandingAmount, bookingCurrency\)\}/);
  assert.match(panel, /defaultValue=\{moneyMinorToMajorString\(nextRefundableSourceAmount, bookingCurrency\)\}/);
  assert.match(panel, /Record payment/);
  assert.match(panel, /Record refund/);
});

test('guarded PostgreSQL coverage includes partial funding, replay, overpayment rejection, refund, and zero-net cancellation safety', () => {
  assert.match(databaseRunner, /src\/server\/payments\/rental-payment\.integration\.ts/);
  assert.match(integration, /partialPaymentMinor/);
  assert.match(integration, /paymentState, 'PARTIALLY_PAID'/);
  assert.match(integration, /partialPaymentReplay/);
  assert.match(integration, /secondPayment/);
  assert.match(integration, /paymentState, 'PAID'/);
  assert.match(integration, /outstanding booking balance/i);
  assert.match(integration, /partialRefundMinor/);
  assert.match(integration, /paymentState, 'PARTIALLY_REFUNDED'/);
  assert.match(integration, /paymentState, 'REFUNDED'/);
  assert.match(integration, /cancelRentalBooking/);
  assert.match(integration, /rentalPaymentTransaction\.update/);
});

test('documentation keeps partial manual funding real and unsupported provider boundaries explicit', () => {
  assert.match(docs, /multiple real manual\/offline booking-price payments/i);
  assert.match(docs, /`PARTIALLY_PAID`/);
  assert.match(docs, /browser never chooses the tenant, actor, provider/i);
  assert.match(docs, /current outstanding balance/i);
  assert.match(docs, /does not implement deposits or deposit policy, card authorization, Stripe rental checkout/i);
  assert.match(docs, /mixed-provider settlement/i);
  assert.match(docs, /No placeholder route or fake provider action/i);
  assert.match(docs, /GitHub Actions are not required or used/);
});
