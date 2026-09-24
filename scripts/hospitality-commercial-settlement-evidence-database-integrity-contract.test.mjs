import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../prisma/migrations/20260924233000-hospitality-commercial-settlement-evidence-integrity/migration.sql', import.meta.url),
  'utf8',
);
const integration = readFileSync(
  new URL('../src/server/payments/hospitality-commercial-settlement-evidence-database-integrity.integration.ts', import.meta.url),
  'utf8',
);
const databaseRunner = readFileSync(new URL('./run-database-tests.mjs', import.meta.url), 'utf8');
const docs = readFileSync(new URL('../docs/commercial-adjustment-settlement-evidence.md', import.meta.url), 'utf8');

test('database binds frozen evidence headers to the immutable legal note', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION sf_validate_hospitality_commercial_settlement_evidence_insert/);
  assert.match(migration, /NEW\."issuedAt" IS DISTINCT FROM note_issued_at/);
  assert.match(migration, /note\."adjustmentReason" = 'COMMERCIAL_AMENDMENT'/);
  assert.match(migration, /schemaVersion'\) IN \('2', '3', '4', '5'\)/);
});

test('database requires each frozen transaction to match source payment truth at capture time', () => {
  assert.match(migration, /CREATE FUNCTION sf_validate_hospitality_commercial_settlement_tx_insert/);
  assert.match(migration, /FROM "payment_transactions" payment/);
  assert.match(migration, /payment\."commercialAmendmentId" IS NOT DISTINCT FROM NEW\."commercialAmendmentId"/);
  assert.match(migration, /payment\."status" = NEW\."status"/);
  assert.match(migration, /payment\."providerReference" = NEW\."providerReference"/);
  assert.match(migration, /payment\."amountMinor" = NEW\."amountMinor"/);
  assert.match(migration, /payment\."createdAt" = NEW\."sourceCreatedAt"/);
  assert.match(migration, /legal_note\."sourceAdjustmentOrdinal" <= evidence_source_adjustment_ordinal/);
  assert.match(migration, /BEFORE INSERT ON "hospitality_commercial_settlement_evidence_transactions"/);
});

test('database enforces monotonic frozen payment membership in both ordinal directions', () => {
  assert.match(migration, /previous_evidence_id/);
  assert.match(migration, /next_evidence_id/);
  assert.match(migration, /cannot drop previously frozen payment identities/);
  assert.match(migration, /cannot introduce membership missing from a later frozen ledger/);
  assert.match(migration, /DEFERRABLE INITIALLY DEFERRED/);
});

test('disposable database harness verifies the installed guards without GitHub Actions', () => {
  assert.match(databaseRunner, /hospitality-commercial-settlement-evidence-database-integrity\.integration\.ts/);
  assert.match(integration, /TEST_DATABASE_URL/);
  assert.match(integration, /pg_get_triggerdef/);
  assert.match(integration, /pg_get_functiondef/);
  assert.match(docs, /PostgreSQL now independently binds the frozen header issue time/i);
  assert.doesNotMatch(`${migration}\n${integration}\n${databaseRunner}\n${docs}`, /\.github\/workflows/);
});

test('new PostgreSQL identifiers stay within the 63-byte storage limit', () => {
  const identifiers = [
    ...migration.matchAll(/(?:TRIGGER|FUNCTION)\s+"?([a-zA-Z0-9_]+)"?/g),
  ].map((match) => match[1]);
  assert.ok(identifiers.length >= 5);
  for (const identifier of identifiers) {
    assert.ok(Buffer.byteLength(identifier, 'utf8') <= 63, `${identifier} exceeds PostgreSQL identifier storage`);
  }
});
