import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const prisma = await readFile(new URL('../prisma/rental-booking-effective-refunds.prisma', import.meta.url), 'utf8');
const amendments = await readFile(new URL('../prisma/rental-booking-commercial-amendments.prisma', import.meta.url), 'utf8');
const migration = await readFile(new URL('../prisma/migrations/20260918173000_rental_post_apply_effective_refunds/migration.sql', import.meta.url), 'utf8');
const domain = await readFile(new URL('../src/server/bookings/rental-booking-effective-refund-domain.ts', import.meta.url), 'utf8');
const service = await readFile(new URL('../src/server/bookings/rental-booking-effective-refund-service.ts', import.meta.url), 'utf8');
const history = await readFile(new URL('../src/server/bookings/rental-booking-effective-refund-history.ts', import.meta.url), 'utf8');
const effectiveService = await readFile(new URL('../src/server/bookings/rental-booking-effective-settlement-service.ts', import.meta.url), 'utf8');
const page = await readFile(new URL('../app/inventory/rentals/bookings/[booking-id]/commercial-amendments/[amendment-id]/page.tsx', import.meta.url), 'utf8');
const actionRoute = await readFile(new URL('../app/api/inventory/rentals/bookings/[booking-id]/commercial-amendments/[amendment-id]/route.ts', import.meta.url), 'utf8');
const docs = await readFile(new URL('../docs/rental-booking-effective-settlement.md', import.meta.url), 'utf8');

test('schema retains tenant-owned append-only post-apply refund evidence', () => {
  assert.match(prisma, /enum RentalBookingEffectiveRefundSourceLedger/);
  assert.match(prisma, /BOOKING_PRICE/);
  assert.match(prisma, /COMMERCIAL_AMENDMENT/);
  assert.match(prisma, /model RentalBookingEffectiveRefundTransaction/);
  assert.match(prisma, /amendmentId/);
  assert.match(prisma, /requestFingerprint/);
  assert.match(prisma, /sourceProviderReference/);
  assert.match(prisma, /@@unique\(\[organizationId, idempotencyKey\]/);
  assert.match(prisma, /@@unique\(\[organizationId, providerCode, providerReference\]/);
  assert.match(amendments, /effectiveRefundTransactions RentalBookingEffectiveRefundTransaction\[\]/);
});

test('database independently enforces applied amendment authority and per-source caps', () => {
  assert.match(migration, /sf_author_rental_booking_effective_refund_transaction/);
  assert.match(migration, /amendment_status <> 'APPLIED'/);
  assert.match(migration, /NEW\."sourceLedger" = 'BOOKING_PRICE'/);
  assert.match(migration, /post-apply booking-price refund exceeds the retained source payment balance/);
  assert.match(migration, /amendment_direction <> 'ADDITIONAL_CHARGE'/);
  assert.match(migration, /post-apply amendment-charge refund exceeds the retained adjustment payment balance/);
  assert.match(migration, /post-apply rental refund evidence is append-only/);
  assert.match(migration, /NEW\."createdAt" := authored_at/);
});

test('manual reference namespace uses the central tenant registry before post-apply provider evidence', () => {
  assert.match(migration, /sf:rental-manual-reference:/);
  assert.match(migration, /rental_booking_effective_refund_transactions/);
  assert.match(migration, /manual rental provider reference is already retained as post-apply effective refund evidence/);
  assert.match(service, /rentalManualProviderReference\.findUnique/);
  assert.match(service, /organizationId_providerReference/);
  assert.match(service, /assertManualReferenceUnused\(transaction, input\.organizationId, reference\)/);
  assert.ok(
    service.indexOf('assertManualReferenceUnused(transaction, input.organizationId, reference)')
      < service.indexOf('manualProvider.recordOfflineRefund'),
  );
  assert.doesNotMatch(
    service,
    /rentalLateReturnSettlementTransaction\.findFirst\(\{\s*where: \{ organizationId, providerCode: 'manual', providerReference: reference/s,
  );
});

test('writer derives source server-side under permission and serializable booking authority', () => {
  assert.match(service, /recordRentalBookingPostApplyManualRefund/);
  assert.match(service, /permission: 'booking:manage'/);
  assert.match(service, /permission: 'payment:manage'/);
  assert.match(service, /rentalBookingLockKey/);
  assert.match(service, /deriveRentalBookingEffectiveRefundPlan/);
  assert.match(service, /assertPaymentProviderCapability\(manualProvider, 'OFFLINE_REFUND_RECORDING'\)/);
  assert.match(service, /manualProvider\.recordOfflineRefund/);
  assert.match(service, /buildRentalBookingEffectiveRefundIdempotencyKey/);
  assert.match(service, /buildRentalBookingEffectiveRefundRequestFingerprint/);
  assert.match(service, /isolationLevel: 'Serializable'/);
  assert.match(service, /payment\.rental\.post-apply-refund-recorded/);
  assert.doesNotMatch(service, /sourceProviderReference\?: unknown/);
});

test('bounded reader and staff orchestration keep post-apply refund source authority on the server', () => {
  assert.match(history, /MAX_TRANSACTIONS = 1_000/);
  assert.match(history, /expectedIdempotencyKey/);
  assert.match(history, /expectedFingerprint/);
  assert.match(effectiveService, /postApplyRefunds: effectiveRefundHistory\.transactions/);
  assert.match(page, /nextRefundSource/);
  assert.match(page, /Record post-apply refund/);
  assert.match(actionRoute, /readRentalBookingEffectiveSettlement/);
  assert.match(actionRoute, /parseMoneyMajorToMinor/);
  assert.match(actionRoute, /recordRentalBookingPostApplyManualRefund/);
  assert.doesNotMatch(actionRoute, /sourceProviderReference: formField/);
  assert.match(docs, /authenticated staff workspace/i);
  assert.match(docs, /Provider-backed\/online refund execution remains later adapter-backed scope/i);
});
