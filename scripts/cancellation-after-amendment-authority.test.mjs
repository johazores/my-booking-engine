import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(new URL('../prisma/migrations/20260905113000_cancellation-after-amendment-authority/migration.sql', import.meta.url), 'utf8');
const invoiceModel = await readFile(new URL('../prisma/invoice-foundation.prisma', import.meta.url), 'utf8');
const snapshotDomain = await readFile(new URL('../src/server/payments/hospitality-cancellation-after-amendment-adjustment-note-domain.ts', import.meta.url), 'utf8');
const readinessDomain = await readFile(new URL('../src/server/payments/hospitality-cancellation-after-amendment-adjustment-domain.ts', import.meta.url), 'utf8');
const readinessService = await readFile(new URL('../src/server/payments/hospitality-cancellation-after-amendment-adjustment-service.ts', import.meta.url), 'utf8');
const contractDoc = await readFile(new URL('../docs/cancellation-after-amendment-adjustments.md', import.meta.url), 'utf8');
const route = await readFile(new URL('../app/api/bookings/hospitality/[booking-id]/adjustment-notes/route.ts', import.meta.url), 'utf8').catch(() => '');

test('migration admits terminal schema-version-6 cancellation with modeled same-scope predecessor ownership', () => {
  assert.match(migration, /"adjustmentReason" = 'BOOKING_CANCELLATION'[\s\S]*"sourceAdjustmentOrdinal" >= 2/);
  assert.match(migration, /"documentSnapshot"->>'schemaVersion' = '6'/);
  assert.match(migration, /CREATE UNIQUE INDEX "hospitality_adj_notes_chain_reference_any_reason_key"/);
  assert.match(migration, /FOREIGN KEY \([\s\S]*"predecessorAdjustmentNoteId"[\s\S]*"bookingId"[\s\S]*"organizationId"[\s\S]*"sourceInvoiceId"[\s\S]*"predecessorSourceAdjustmentOrdinal"/);
  assert.match(invoiceModel, /@@unique\(\[id, bookingId, organizationId, sourceInvoiceId, sourceAdjustmentOrdinal\], map: "hospitality_adj_notes_chain_reference_any_reason_key"\)/);
  assert.doesNotMatch(migration.match(/FOREIGN KEY \([\s\S]*?\)\s*REFERENCES/)?.[0] ?? '', /adjustmentReason/);
});

test('schema-version-6 snapshot freezes predecessor and bounded ordered multi-refund authority', () => {
  assert.match(snapshotDomain, /schemaVersion: 6/);
  assert.match(snapshotDomain, /predecessorAdjustmentNoteId/);
  assert.match(snapshotDomain, /predecessorAdjustmentDocumentFingerprint/);
  assert.match(snapshotDomain, /predecessorAfterPricingFingerprint/);
  assert.match(snapshotDomain, /refundAuthorities/);
  assert.match(snapshotDomain, /HOSPITALITY_CANCELLATION_AFTER_AMENDMENT_REFUND_LIMIT/);
  assert.match(migration, /jsonb_array_length\("documentSnapshot"->'refundAuthorities'\) BETWEEN 1 AND 256/);
});

test('cancellation readiness re-proves settlement at the legal head and current zero settlement', () => {
  assert.match(readinessDomain, /settlementAtHead\.netSettledMinor !== head\.totalMinor/);
  assert.match(readinessDomain, /currentSettlement\.netSettledMinor !== 0n/);
  assert.match(readinessDomain, /commercialAmendmentId !== null/);
  assert.match(readinessDomain, /sourceProviderReference == null/);
});

test('server readiness is tenant scoped and requires payment management authority', () => {
  assert.match(readinessService, /permission: 'payment:manage'/);
  assert.match(readinessService, /organizationId: input\.organizationId/);
  assert.match(readinessService, /bookingId: input\.bookingId/);
  assert.match(readinessService, /loadVerifiedHospitalityCommercialAmendmentAdjustmentChain/);
});

test('documentation explicitly keeps schema-version-6 product reachability closed', () => {
  assert.match(contractDoc, /not product-reachable yet/i);
  assert.match(contractDoc, /shared post-issuance read authority/i);
});

test('existing public product route remains fail closed for schema-version-6 issuance in this foundation slice', () => {
  if (!route) return;
  assert.match(route, /refundTransactionId/);
  assert.doesNotMatch(route, /CancellationAfterAmendment/);
});
