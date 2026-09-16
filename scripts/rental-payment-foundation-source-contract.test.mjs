import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const schema = readFileSync('prisma/rental-payment-transactions.prisma', 'utf8');
const rentalSchema = readFileSync('prisma/rental-inventory.prisma', 'utf8');
const migration = readFileSync('prisma/migrations/20260915235000_rental_payment_foundation/migration.sql', 'utf8');
const domain = readFileSync('src/server/payments/rental-payment-domain.ts', 'utf8');
const service = readFileSync('src/server/payments/rental-payment-service.ts', 'utf8');
const cancellation = readFileSync('src/server/bookings/rental-booking-cancellation-service.ts', 'utf8');
const paymentRoute = readFileSync('app/api/inventory/rentals/bookings/[booking-id]/payments/manual/route.ts', 'utf8');
const refundRoute = readFileSync('app/api/inventory/rentals/bookings/[booking-id]/payments/refunds/route.ts', 'utf8');
const detail = readFileSync('app/inventory/rentals/bookings/[booking-id]/page.tsx', 'utf8');
const panel = readFileSync('src/components/rental-booking-payment-panel.tsx', 'utf8');
const docs = readFileSync('docs/rental-payment-foundation.md', 'utf8');
const databaseRunner = readFileSync('scripts/run-database-tests.mjs', 'utf8');
const integration = readFileSync('src/server/payments/rental-payment.integration.ts', 'utf8');

test('rental payment persistence is tenant-owned and refund-source attributed', () => {
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
  assert.match(migration, /sf_guard_rental_payment_transaction_insert/);
  assert.match(migration, /parent_booking\."status" <> 'CONFIRMED'/);
  assert.match(migration, /NEW\."amountMinor" <> parent_booking\."totalMinor"/);
  assert.match(migration, /rental_payment_transactions_org_provider_reference_key/);
  assert.match(migration, /rental refund exceeds its settled source payment/);
  assert.match(migration, /rental payment transaction evidence is append-only/);
});

test('manual rental settlement uses provider adapters, server idempotency, booking serialization, and complete history', () => {
  assert.match(service, /permission: 'payment:manage'/);
  assert.match(service, /ManualPaymentProvider/);
  assert.match(service, /buildRentalPaymentIdempotencyKey/);
  assert.match(service, /rentalBookingLockKey\(input\.organizationId, input\.bookingId\)/);
  assert.match(service, /where: \{ id: input\.bookingId, organizationId: input\.organizationId \}/);
  assert.match(service, /rentalPaymentTransaction\.findMany/);
  assert.match(service, /deriveRentalPaymentSettlement/);
  assert.match(service, /recordOfflinePayment/);
  assert.match(service, /recordOfflineRefund/);
  assert.match(service, /sourceProviderReference: plan\.sourceProviderReference/);
  assert.match(service, /classifyRentalBookingWriteError/);
  assert.match(service, /retryUniqueConflict: true/);
  assert.match(service, /attempt < 2/);
  assert.match(service, /Rental payment write could not be serialized after bounded retries/);
  assert.match(service, /isolationLevel: 'Serializable'/);
  assert.match(domain, /createHash\('sha256'\)/);
  assert.match(domain, /settlement\.grossSettledMinor === 0n/);
});

test('rental cancellation fails closed until payment settlement is reconciled to zero', () => {
  assert.match(cancellation, /rentalPaymentTransaction\.findMany/);
  assert.match(cancellation, /deriveRentalPaymentSettlement/);
  assert.match(cancellation, /paymentSettlement\.netSettledMinor !== 0n/);
  assert.match(cancellation, /Refund all settled rental money before cancelling/);
  assert.match(migration, /sf_guard_rental_booking_cancellation_payment_settlement/);
  assert.match(migration, /'sf:rental-booking:' \|\| OLD\."organizationId"::text \|\| ':booking:' \|\| OLD\."id"::text/);
  assert.match(migration, /"status" IN \('PENDING', 'AMBIGUOUS'\)/);
  assert.match(migration, /payment\."providerCode" <> 'manual'/);
  assert.match(migration, /net_settled_minor <> 0/);
});

test('staff routes derive tenant and actor server-side and accept only real external references', () => {
  for (const route of [paymentRoute, refundRoute]) {
    assert.match(route, /prepareInventoryMutationRequest/);
    assert.match(route, /organizationId: organization\.id/);
    assert.match(route, /actorUserId: session\.user\.id/);
    assert.match(route, /formData\.get\('reference'\)/);
    assert.doesNotMatch(route, /formData\.get\('organizationId'\)/);
    assert.doesNotMatch(route, /formData\.get\('actorUserId'\)/);
    assert.doesNotMatch(route, /formData\.get\('amount/);
    assert.doesNotMatch(route, /formData\.get\('idempotency/);
  }
  assert.match(detail, /listRentalBookingPaymentTransactions/);
  assert.match(detail, /paymentData\.settlement\.netSettledMinor === 0n/);
  assert.match(panel, /Record full payment/);
  assert.match(panel, /Record remaining refund/);
});

test('guarded PostgreSQL coverage exercises tenant scope, settlement cancellation blocking, refund, and append-only evidence', () => {
  assert.match(databaseRunner, /src\/server\/payments\/rental-payment\.integration\.ts/);
  assert.match(integration, /recordRentalManualOfflinePayment/);
  assert.match(integration, /organizationId: otherOrganization\.id/);
  assert.match(integration, /cancelRentalBooking/);
  assert.match(integration, /refund all settled rental money/i);
  assert.match(integration, /recordRentalManualOfflineRefund/);
  assert.match(integration, /paymentState, 'REFUNDED'/);
  assert.match(integration, /rentalPaymentTransaction\.update/);
  assert.match(integration, /append-only/i);
});

test('documentation keeps unsupported rental commercial workflows explicit', () => {
  assert.match(docs, /not a deposit workflow/i);
  assert.match(docs, /not an online checkout workflow/i);
  assert.match(docs, /does not implement deposits, card authorization, Stripe rental checkout/i);
  assert.match(docs, /No placeholder route or dead payment action/);
  assert.match(docs, /GitHub Actions are not required or used/);
});
