import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const migrationPath = 'prisma/migrations/20260909035000_supplier-reservation-provider-evidence-guard/migration.sql';

test('database guard requires durable provider evidence for provider-derived attempt states', () => {
  const migration = source(migrationPath);

  assert.match(
    migration,
    /"kind" = 'CREATE' AND "status" IN \('SUCCEEDED', 'REVIEW_REQUIRED', 'AMBIGUOUS'\)/,
  );
  assert.match(
    migration,
    /"kind" = 'RECONCILE' AND "status" IN \('SUCCEEDED', 'NOT_FOUND'\)/,
  );
  assert.match(
    migration,
    /"kind" = 'RECOVERY_WRITE' AND "status" IN \('SUCCEEDED', 'AMBIGUOUS'\)/,
  );
  assert.match(
    migration,
    /"providerRequestStartedAt" IS NOT NULL[\s\S]{0,500}NOT VALID;/,
  );
  assert.match(
    migration,
    /UPDATE "hospitality_supplier_reservation_attempts"[\s\S]{0,900}"providerRequestStartedAt" = COALESCE\("providerRequestStartedAt", "leaseStartedAt", "startedAt"\)/,
  );
  assert.match(
    migration,
    /VALIDATE CONSTRAINT "hospitality_supplier_reservation_attempt_provider_evidence_check"/,
  );
});

test('database guard keeps supplier review authority create-only and reason-specific', () => {
  const migration = source(migrationPath);

  assert.match(
    migration,
    /"status" <> 'REVIEW_REQUIRED' OR "kind" = 'CREATE'/,
  );
  assert.match(
    migration,
    /"status" <> 'REVIEW_REQUIRED'[\s\S]{0,240}'SUPPLIER_PRICE_CHANGED'[\s\S]{0,160}'SUPPLIER_GUARANTEE_CHANGED'[\s\S]{0,160}'SUPPLIER_PRICE_AND_GUARANTEE_CHANGED'/,
  );
  assert.match(
    migration,
    /VALIDATE CONSTRAINT "hospitality_supplier_reservation_attempt_review_kind_check"/,
  );
  assert.match(
    migration,
    /VALIDATE CONSTRAINT "hospitality_supplier_reservation_attempt_review_failure_code_check"/,
  );
});

test('provider-evidence documentation preserves legitimate pre-provider states', () => {
  const doc = source('docs/supplier-reservation-provider-evidence.md');

  assert.match(doc, /CREATE \/ FAILED.*unmarked/is);
  assert.match(doc, /RECONCILE \/ AMBIGUOUS.*unmarked/is);
  assert.match(doc, /RECOVERY_WRITE \/ FAILED.*unmarked/is);
  assert.match(doc, /database constraints are defense in depth/i);
  assert.match(doc, /not live-validated/i);
});
