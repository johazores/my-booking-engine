import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const model = readFileSync(new URL('../prisma/invoice-foundation.prisma', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL('../prisma/migrations/20260904162500_cumulative-adjustment-note-chain/migration.sql', import.meta.url),
  'utf8',
);

test('Prisma exposes cumulative adjustment-note chain authority without changing legacy authorities', () => {
  assert.match(model, /predecessorAdjustmentNoteId\s+String\?\s+@unique\(map: "hospitality_adj_notes_predecessor_key"\)\s+@db\.Uuid/);
  assert.match(model, /predecessorSourceAdjustmentOrdinal\s+Int\?/);
  assert.match(model, /@@unique\(\[id, bookingId, organizationId, sourceInvoiceId, sourceAdjustmentOrdinal, adjustmentReason\], map: "hospitality_adj_notes_chain_reference_key"\)/);
  assert.match(model, /refundTransactionId\s+String\?\s+@unique/);
  assert.match(model, /commercialAmendmentId\s+String\?\s+@unique/);
});

test('migration makes predecessor authority same-tenant, same-booking, same-source, and same-reason', () => {
  assert.match(migration, /FOREIGN KEY \(\s*"predecessorAdjustmentNoteId",\s*"bookingId",\s*"organizationId",\s*"sourceInvoiceId",\s*"predecessorSourceAdjustmentOrdinal",\s*"adjustmentReason"\s*\)/s);
  assert.match(migration, /REFERENCES "hospitality_issued_adjustment_notes"\(\s*"id",\s*"bookingId",\s*"organizationId",\s*"sourceInvoiceId",\s*"sourceAdjustmentOrdinal",\s*"adjustmentReason"\s*\)/s);
  assert.match(migration, /ON DELETE RESTRICT ON UPDATE CASCADE/);
});

test('migration prevents forks, self-predecessors and ordinal gaps', () => {
  assert.match(migration, /CREATE UNIQUE INDEX "hospitality_adj_notes_predecessor_key"/);
  assert.match(migration, /"predecessorAdjustmentNoteId" IS DISTINCT FROM "id"/);
  assert.match(migration, /"predecessorSourceAdjustmentOrdinal" = "sourceAdjustmentOrdinal" - 1/);
  assert.match(migration, /"sourceAdjustmentOrdinal" >= 2/);
});

test('migration preserves v1 and v2 while binding persisted repeated documents to schema v3', () => {
  assert.match(migration, /"adjustmentReason" = 'BOOKING_CANCELLATION'[\s\S]*"documentSnapshot"->>'schemaVersion' = '1'/);
  assert.match(migration, /"adjustmentReason" = 'COMMERCIAL_AMENDMENT'[\s\S]*"sourceAdjustmentOrdinal" = 1[\s\S]*"documentSnapshot"->>'schemaVersion' = '2'/);
  assert.match(migration, /"sourceAdjustmentOrdinal" >= 2[\s\S]*"documentSnapshot"->>'schemaVersion' = '3'/);
  assert.match(migration, /"documentSnapshot"->>'predecessorAdjustmentNoteId' = "predecessorAdjustmentNoteId"::text/);
  assert.match(migration, /"documentSnapshot"->>'beforePricingFingerprint' = "documentSnapshot"->>'predecessorAfterPricingFingerprint'/);
});
