import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const model = readFileSync(new URL('../prisma/invoice-foundation.prisma', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL('../prisma/migrations/20260904194500_increasing-adjustment-note-persistence/migration.sql', import.meta.url),
  'utf8',
);

test('Prisma separates increasing and decreasing material adjustment effects without breaking existing writers', () => {
  assert.match(model, /adjustmentType\s+String\s+@default\("DECREASING"\)\s+@db\.VarChar\(16\)/);
  assert.match(model, /increaseSubtotalMinor\s+BigInt\s+@default\(0\)\s+@db\.BigInt/);
  assert.match(model, /increaseTaxMinor\s+BigInt\s+@default\(0\)\s+@db\.BigInt/);
  assert.match(model, /increaseTotalMinor\s+BigInt\s+@default\(0\)\s+@db\.BigInt/);
  assert.match(model, /decreaseTotalMinor\s+BigInt\s+@db\.BigInt/);
});

test('migration preserves legacy decreasing rows while making adjustment direction explicit', () => {
  assert.match(migration, /ADD COLUMN "adjustmentType" VARCHAR\(16\) NOT NULL DEFAULT 'DECREASING'/);
  assert.match(migration, /ADD COLUMN "increaseSubtotalMinor" BIGINT NOT NULL DEFAULT 0/);
  assert.match(migration, /"adjustmentType" = 'DECREASING'[\s\S]*"increaseTotalMinor" = 0/);
  assert.match(migration, /"adjustmentType" = 'INCREASING'[\s\S]*"decreaseTotalMinor" = 0[\s\S]*"increaseTaxMinor" \* 11 = "increaseTotalMinor"/);
});

test('schema version 4 binds first increasing commercial amendment evidence to material columns', () => {
  assert.match(migration, /"adjustmentType" = 'INCREASING'[\s\S]*"adjustmentReason" = 'COMMERCIAL_AMENDMENT'[\s\S]*"sourceAdjustmentOrdinal" = 1/);
  assert.match(migration, /"documentSnapshot"->>'schemaVersion' = '4'/);
  assert.match(migration, /"documentSnapshot"->>'increaseSubtotalMinor' = "increaseSubtotalMinor"::text/);
  assert.match(migration, /"documentSnapshot"->>'increaseTaxMinor' = "increaseTaxMinor"::text/);
  assert.match(migration, /"documentSnapshot"->>'increaseTotalMinor' = "increaseTotalMinor"::text/);
  assert.match(migration, /\("documentSnapshot"->>'afterTotalMinor'\)::bigint - \("documentSnapshot"->>'beforeTotalMinor'\)::bigint = "increaseTotalMinor"/);
  assert.match(migration, /NOT \("documentSnapshot" \? 'decreaseTotalMinor'\)/);
});

test('schema version 4 remains first-adjustment-only and cannot smuggle predecessor or refund authority', () => {
  assert.match(migration, /"predecessorAdjustmentNoteId" IS NULL/);
  assert.match(migration, /"predecessorSourceAdjustmentOrdinal" IS NULL/);
  assert.match(migration, /NOT \("documentSnapshot" \? 'refundTransactionId'\)/);
  assert.match(migration, /NOT \("documentSnapshot" \? 'predecessorAdjustmentNoteId'\)/);
});

test('legacy v1, v2 and v3 decreasing snapshots remain explicitly accepted', () => {
  assert.match(migration, /"adjustmentType" = 'DECREASING'[\s\S]*"adjustmentReason" = 'BOOKING_CANCELLATION'[\s\S]*"documentSnapshot"->>'schemaVersion' = '1'/);
  assert.match(migration, /"adjustmentType" = 'DECREASING'[\s\S]*"adjustmentReason" = 'COMMERCIAL_AMENDMENT'[\s\S]*"documentSnapshot"->>'schemaVersion' = '2'/);
  assert.match(migration, /"sourceAdjustmentOrdinal" >= 2[\s\S]*"documentSnapshot"->>'schemaVersion' = '3'/);
}
);
