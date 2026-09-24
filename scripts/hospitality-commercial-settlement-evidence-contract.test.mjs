import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../prisma/migrations/20260924222000-hospitality-commercial-settlement-evidence/migration.sql', import.meta.url),
  'utf8',
);
const schema = readFileSync(
  new URL('../prisma/hospitality-commercial-settlement-evidence.prisma', import.meta.url),
  'utf8',
);
const evidenceService = readFileSync(
  new URL('../src/server/payments/hospitality-commercial-settlement-evidence-service.ts', import.meta.url),
  'utf8',
);
const chainService = readFileSync(
  new URL('../src/server/payments/hospitality-commercial-amendment-adjustment-chain-service.ts', import.meta.url),
  'utf8',
);
const docs = readFileSync(
  new URL('../docs/commercial-adjustment-settlement-evidence.md', import.meta.url),
  'utf8',
);

test('new commercial adjustment notes freeze bounded issue-time provider-neutral payment evidence', () => {
  assert.match(migration, /AFTER INSERT ON "hospitality_issued_adjustment_notes"/);
  assert.match(migration, /snapshot_schema_version NOT IN \(2, 3, 4, 5\)/);
  assert.match(migration, /payment\."createdAt" <= NEW\."issuedAt"/);
  assert.match(migration, /payment\."commercialAmendmentId" IS NULL/);
  assert.match(migration, /legal_note\."sourceInvoiceId" = NEW\."sourceInvoiceId"/);
  assert.match(migration, /legal_note\."sourceAdjustmentOrdinal" <= NEW\."sourceAdjustmentOrdinal"/);
  assert.match(migration, /captured_transaction_count < 1 OR captured_transaction_count > 5000/);
  assert.match(migration, /"status"/);
  assert.match(migration, /"sourceProviderReference"/);
});

test('frozen settlement evidence is versioned, tenant-scoped, immutable, and intentionally not backfilled', () => {
  assert.match(schema, /model HospitalityCommercialSettlementEvidence/);
  assert.match(schema, /schemaVersion\s+Int\s+@default\(1\)/);
  assert.match(schema, /transactionCount\s+Int/);
  assert.match(schema, /model HospitalityCommercialSettlementEvidenceTransaction/);
  assert.match(schema, /status\s+PaymentTransactionStatus/);
  assert.match(schema, /@@unique\(\[adjustmentNoteId, organizationId, bookingId\]/);
  assert.match(migration, /commercial settlement evidence does not match an issued tenant-scoped adjustment note/);
  assert.match(migration, /hospitality commercial settlement evidence is immutable/);
  assert.match(migration, /hospitality_commercial_settlement_evidence_count_guard/);
  assert.match(migration, /hospitality_commercial_settlement_evidence_tx_count_guard/);
  assert.match(migration, /actual_count IS DISTINCT FROM expected_count/);
  assert.match(migration, /Existing schemas 2-5 are intentionally not backfilled/);
  assert.doesNotMatch(migration, /UPDATE\s+"hospitality_issued_adjustment_notes"\s+SET\s+"documentSnapshot"/i);
});

test('historical chain prefers frozen evidence and reads mutable payment history only for legacy rows', () => {
  assert.match(chainService, /loadHospitalityFrozenCommercialSettlementEvidence/);
  assert.match(chainService, /find\(\(row\) => !frozenSettlementEvidence\.has\(row\.id\)\)/);
  assert.match(chainService, /const frozenTransactions = frozenSettlementEvidence\.get\(row\.id\)/);
  assert.match(chainService, /const settlementTransactionsAtIssue = frozenTransactions \?\?/);
  assert.match(evidenceService, /header\.organizationId !== input\.organizationId/);
  assert.match(evidenceService, /rows\.length !== header\.transactionCount/);
  assert.match(evidenceService, /allowedAmendmentIds/);
  assert.match(evidenceService, /row\.sourceCreatedAt\.getTime\(\) > header\.issuedAt\.getTime\(\)/);
});

test('current provider lifecycle reconciliation remains separate from frozen historical authority', () => {
  assert.match(docs, /historical legal authority replays the frozen issue-time ledger/);
  assert.match(docs, /current provider lifecycle remains mutable operational truth/);
  assert.match(docs, /Existing commercial adjustment notes are intentionally \*\*not backfilled\*\*/);
});

test('new physical identifiers fit PostgreSQL and no GitHub Actions are introduced', () => {
  const identifiers = [
    ...migration.matchAll(/(?:CONSTRAINT|TRIGGER|FUNCTION|INDEX)\s+"?([a-zA-Z0-9_]+)"?/g),
  ].map((match) => match[1]);
  assert.ok(identifiers.length >= 10);
  for (const identifier of identifiers) {
    assert.ok(Buffer.byteLength(identifier, 'utf8') <= 63, `${identifier} exceeds PostgreSQL identifier storage`);
  }

  const combined = `${migration}\n${schema}\n${evidenceService}\n${chainService}\n${docs}`;
  assert.doesNotMatch(combined, /\.github\/workflows|github actions/i);
});
