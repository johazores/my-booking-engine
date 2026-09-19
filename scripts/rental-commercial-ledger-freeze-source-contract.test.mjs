import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const service = readFileSync('src/server/payments/rental-payment-service.ts', 'utf8');
const panel = readFileSync('src/components/rental-booking-payment-panel.tsx', 'utf8');
const migration = readFileSync('prisma/migrations/20260919025000-rental-commercial-ledger-freeze/migration.sql', 'utf8');
const paymentDocs = readFileSync('docs/rental-payment-foundation.md', 'utf8');
const commercialDocs = readFileSync('docs/rental-booking-commercial-amendments.md', 'utf8');

const paymentWrite = service.slice(
  service.indexOf('export async function recordRentalManualOfflinePayment'),
  service.indexOf('export async function recordRentalManualOfflineRefund'),
);
const refundWrite = service.slice(
  service.indexOf('export async function recordRentalManualOfflineRefund'),
  service.indexOf('export async function listRentalBookingPaymentTransactions'),
);

test('new original booking-price writes freeze before provider execution once commercial authority is active', () => {
  assert.match(service, /status: \{ in: \['PREPARED', 'APPLIED'\] \}/);
  assert.match(service, /async function assertOriginalRentalPaymentLedgerWritable/);
  assert.match(service, /Original booking-price settlement is frozen while a rental commercial amendment is prepared/);
  assert.match(service, /Original booking-price settlement is historical after a rental commercial amendment is applied/);

  for (const [scope, providerCall] of [
    [paymentWrite, 'manualProvider.recordOfflinePayment'],
    [refundWrite, 'manualProvider.recordOfflineRefund'],
  ]) {
    const replayIndex = scope.indexOf('if (existing)');
    const freezeIndex = scope.indexOf('assertOriginalRentalPaymentLedgerWritable');
    const providerIndex = scope.indexOf(providerCall);
    assert.ok(replayIndex >= 0 && replayIndex < freezeIndex, 'durable idempotent replay must remain available before the freeze check');
    assert.ok(freezeIndex >= 0 && freezeIndex < providerIndex, 'commercial freeze must run before provider execution');
  }
});

test('protected read authority is tenant scoped and fail-closed for conflicting active amendments', () => {
  assert.match(service, /export async function readRentalOriginalPaymentLedgerAuthority/);
  assert.match(service, /permission: 'payment:read'/);
  assert.match(service, /where: \{ id: input\.bookingId, organizationId: input\.organizationId \}/);
  assert.match(service, /take: 2/);
  assert.match(service, /Conflicting active rental commercial amendments prevent original booking-price settlement writes/);
  assert.match(service, /isolationLevel: 'RepeatableRead'/);
});

test('PostgreSQL independently freezes the original ledger for PREPARED and APPLIED amendments', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION sf_guard_rental_payment_after_commercial_amendment/);
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended/);
  assert.match(migration, /amendment\."organizationId" = NEW\."organizationId"/);
  assert.match(migration, /amendment\."bookingId" = NEW\."bookingId"/);
  assert.match(migration, /amendment\."status" IN \('PREPARED', 'APPLIED'\)/);
  assert.match(migration, /ERRCODE = '23514'/);
});

test('staff payment panel exposes no dead original-ledger actions during commercial authority', () => {
  assert.match(panel, /readRentalOriginalPaymentLedgerAuthority/);
  assert.match(panel, /const originalLedgerWritable = ledgerAuthority\?\.writable === true/);
  assert.match(panel, /canRecordPayment = confirmed && originalLedgerWritable/);
  assert.match(panel, /canRefund = confirmed && originalLedgerWritable/);
  assert.match(panel, /Original booking-price writes are frozen/);
  assert.match(panel, /commercial-amendments\/\$\{encodeURIComponent\(ledgerAuthority\.amendment\.id\)\}/);
  assert.match(panel, /Open effective settlement/);
});

test('rental documentation describes the commercial ownership handoff instead of post-apply-only freezing', () => {
  assert.match(paymentDocs, /freezes as soon as a commercial amendment is `PREPARED`/i);
  assert.match(paymentDocs, /idempotent replay/i);
  assert.match(commercialDocs, /original booking-price ledger is frozen from `PREPARED` onward/i);
  assert.match(commercialDocs, /effective settlement workflow owns later refund authority/i);
});
