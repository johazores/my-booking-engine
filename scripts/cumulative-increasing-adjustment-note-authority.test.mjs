import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readiness = readFileSync(
  'src/server/payments/hospitality-commercial-amendment-increasing-adjustment-domain.ts',
  'utf8',
);
const snapshot = readFileSync(
  'src/server/payments/hospitality-commercial-amendment-increasing-adjustment-note-domain.ts',
  'utf8',
);
const migration = readFileSync(
  'prisma/migrations/20260905080000_cumulative-increasing-adjustment-note-authority/migration.sql',
  'utf8',
);
const product = readFileSync(
  'src/server/payments/hospitality-commercial-amendment-adjustment-product-service.ts',
  'utf8',
);

test('cumulative increasing readiness requires a complete verified predecessor chain and derives the legal baseline', () => {
  assert.match(readiness, /priorAdjustments\?: readonly AustralianCommercialAmendmentPriorAdjustment\[\]/);
  assert.match(readiness, /standardGstAdjustmentEffect/);
  assert.match(readiness, /expectedSourceAdjustmentOrdinal: priorChain\.valid \? priorChain\.expectedSourceAdjustmentOrdinal : null/);
  assert.match(readiness, /predecessorAdjustmentNoteId: priorChain\.valid \? priorChain\.predecessorAdjustmentNoteId : null/);
  assert.match(readiness, /AMENDMENT_PREDATES_PRIOR_ADJUSTMENT/);
  assert.match(readiness, /LEGAL_BASELINE_MISMATCH/);
});

test('schema version 5 binds repeated increasing evidence to the immediate predecessor', () => {
  assert.match(snapshot, /schemaVersion: 5;/);
  assert.match(snapshot, /predecessorAdjustmentNoteId: string/);
  assert.match(snapshot, /predecessorAdjustmentDocumentFingerprint: string/);
  assert.match(snapshot, /predecessorAfterPricingFingerprint: string/);
  assert.match(snapshot, /predecessorOrdinal !== sourceAdjustmentOrdinal - 1/);
  assert.match(snapshot, /beforePricingFingerprint !== predecessorAfterPricingFingerprint/);
  assert.match(snapshot, /commercialAmendmentAppliedAt\.getTime\(\) < predecessorIssuedAt\.getTime\(\)/);
});

test('PostgreSQL admits schema version 5 only for repeated increasing commercial amendments with predecessor continuity', () => {
  assert.match(
    migration,
    /"adjustmentType" = 'INCREASING'[\s\S]*"sourceAdjustmentOrdinal" >= 2[\s\S]*"predecessorSourceAdjustmentOrdinal" = "sourceAdjustmentOrdinal" - 1[\s\S]*"documentSnapshot"->>'schemaVersion' = '5'/,
  );
  assert.match(migration, /"documentSnapshot"->>'predecessorAdjustmentNoteId' = "predecessorAdjustmentNoteId"::text/);
  assert.match(migration, /"documentSnapshot"->>'beforePricingFingerprint' = "documentSnapshot"->>'predecessorAfterPricingFingerprint'/);
  assert.match(migration, /"documentSnapshot"->>'increaseTotalMinor' = "increaseTotalMinor"::text/);
  assert.match(migration, /NOT \("documentSnapshot" \? 'decreaseTotalMinor'\)/);
});

test('existing v1-v4 snapshot authorities remain in the replacement database check', () => {
  for (const schemaVersion of ['1', '2', '3', '4']) {
    assert.match(migration, new RegExp(`"documentSnapshot"->>'schemaVersion' = '${schemaVersion}'`));
  }
  assert.match(migration, /"adjustmentType" = 'DECREASING'/);
  assert.match(migration, /"adjustmentReason" = 'BOOKING_CANCELLATION'/);
  assert.match(migration, /"adjustmentReason" = 'COMMERCIAL_AMENDMENT'/);
});

test('product orchestration still keeps repeated increasing writes unreachable until chain/read verification is extended', () => {
  assert.match(product, /sourceState\.kind === 'INCREASING_EXISTS'/);
  assert.match(product, /An increasing commercial-amendment adjustment note has already been issued for this tax invoice\./);
  assert.doesNotMatch(product, /schemaVersion:\s*5/);
});