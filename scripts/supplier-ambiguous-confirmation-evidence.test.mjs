import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('ambiguous supplier confirmation evidence is durable without becoming confirmation authority', () => {
  const service = source('src/server/suppliers/hospitality-supplier-reservation-service.ts');
  const migration = source('prisma/migrations/20260906183000_supplier-ambiguous-confirmation-evidence/migration.sql');
  const domain = source('src/server/suppliers/hospitality-supplier-reservation-domain.ts');

  assert.match(service, /status: 'AMBIGUOUS';[\s\S]*?supplierConfirmationReference\?: unknown;/);
  assert.match(
    service,
    /input\.outcome\.status === 'CONFIRMED' \|\| input\.outcome\.status === 'AMBIGUOUS'[\s\S]*?normalizeHospitalitySupplierReservationSupplierConfirmationReference/,
  );
  assert.match(migration, /"status" IN \('CONFIRMED', 'AMBIGUOUS', 'RECONCILING'\)/);
  assert.match(migration, /char_length\("supplierConfirmationReference"\) BETWEEN 1 AND 512/);
  assert.match(migration, /"supplierConfirmationReference" = btrim\("supplierConfirmationReference"\)/);
  assert.match(migration, /"supplierConfirmationReference" !~ E'\[\\\\r\\\\n\]'/);

  assert.match(domain, /must be reconciled before another create attempt/);
  assert.match(service, /cannot be reconciled automatically without a provider reservation reference/);
});

test('known-locator reconciliation preserves valid prior supplier evidence unless provider truth is NOT_FOUND', () => {
  const service = source('src/server/suppliers/hospitality-supplier-reservation-service.ts');

  assert.match(
    service,
    /input\.outcome\.status === 'FOUND'[\s\S]*?\? supplierConfirmationReference \?\? reservation\.supplierConfirmationReference[\s\S]*?input\.outcome\.status === 'NOT_FOUND'[\s\S]*?\? null[\s\S]*?: reservation\.supplierConfirmationReference/,
  );
  assert.match(
    service,
    /input\.outcome\.status === 'NOT_FOUND'[\s\S]*?\? 'PREPARED'[\s\S]*?providerReservationReference: nextProviderReservationReference[\s\S]*?supplierConfirmationReference: nextSupplierConfirmationReference/,
  );
});

test('documentation keeps supplier confirmation as recovery evidence and Travelport reservation disabled', () => {
  const operations = source('docs/supplier-reservation-operations.md');
  const responseEvidence = source('docs/travelport-reservation-response-evidence.md');
  const integration = source('docs/travelport-stays-integration.md');

  assert.match(operations, /supplier confirmation.*AMBIGUOUS/i);
  assert.match(operations, /does not.*authorize another create/i);
  assert.match(operations, /locator-less[\s\S]*?Sync/i);
  assert.match(responseEvidence, /ambiguous.*supplier confirmation/i);
  assert.match(responseEvidence, /does not.*prove.*Travelport PNR/i);
  assert.match(responseEvidence, /`reservation` capability.*disabled/i);
  assert.match(integration, /supplier confirmation.*`AMBIGUOUS`.*`RECONCILING`.*`CONFIRMED`/i);
  assert.match(integration, /supplier confirmation by itself does not prove.*Travelport PNR/i);
  assert.match(integration, /Booking\.com Sync recovery/i);
});
