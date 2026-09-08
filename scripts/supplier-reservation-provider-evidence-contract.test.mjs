import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('provider-derived create outcomes require the durable provider-request marker', () => {
  const service = source('src/server/suppliers/hospitality-supplier-reservation-service.ts');

  assert.match(
    service,
    /\(input\.outcome\.status === 'CONFIRMED' \|\| input\.outcome\.status === 'AMBIGUOUS'\)[\s\S]{0,160}&& !attempt\.providerRequestStartedAt[\s\S]{0,180}provider outcome is missing durable provider-request evidence/,
  );
});

test('definitive reconciliation truth requires the durable provider-request marker', () => {
  const service = source('src/server/suppliers/hospitality-supplier-reservation-service.ts');

  assert.match(
    service,
    /\(input\.outcome\.status === 'FOUND' \|\| input\.outcome\.status === 'NOT_FOUND'\)[\s\S]{0,160}&& !attempt\.providerRequestStartedAt[\s\S]{0,180}reconciliation outcome is missing durable provider-request evidence/,
  );
});

test('provider-derived recovery-write outcomes require the durable provider-request marker', () => {
  const service = source('src/server/suppliers/hospitality-supplier-reservation-recovery-write-service.ts');

  assert.match(
    service,
    /\(input\.outcome\.status === 'CONFIRMED' \|\| input\.outcome\.status === 'AMBIGUOUS'\)[\s\S]{0,160}&& !attempt\.providerRequestStartedAt[\s\S]{0,180}recovery-write outcome is missing durable provider-request evidence/,
  );
});

test('the provider-neutral recovery contract documents evidence-bearing versus pre-provider settlement', () => {
  const doc = source('docs/supplier-reservation-attempt-recovery.md');

  assert.match(doc, /CREATE.*CONFIRMED.*AMBIGUOUS.*provider-request marker/is);
  assert.match(doc, /RECONCILE.*FOUND.*NOT_FOUND.*provider-request marker/is);
  assert.match(doc, /RECOVERY_WRITE.*CONFIRMED.*AMBIGUOUS.*provider-request marker/is);
  assert.match(doc, /pre-provider.*FAILED.*UNKNOWN/is);
});
