import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('reservation operation entry points materialize caller-owned authority before business validation or provider I/O', async () => {
  const create = await source('src/server/suppliers/travelport-stays-reservation-create-executor.ts');
  const sync = await source('src/server/suppliers/travelport-stays-reservation-sync-executor.ts');
  const recovery = await source('src/server/suppliers/travelport-stays-reservation-recovery-provider.ts');

  assert.match(create, /materializeTravelportStaysReservationOperationInput\(\s*input,\s*CREATE_OPERATION_FIELDS,/s);
  assert.match(create, /materializeTravelportStaysReservationOperationInput\(\s*input,\s*REVIEWED_CREATE_OPERATION_FIELDS,/s);
  assert.match(create, /materializeTravelportStaysReservationOperationInput\(\s*authority\.acceptedReview,\s*ACCEPTED_REVIEW_FIELDS,/s);
  assert.doesNotMatch(create, /#createReservation\(input, input\.acceptedReview\)/);

  assert.match(sync, /const authority = materializeTravelportStaysReservationOperationInput\(\s*input,\s*SYNC_OPERATION_FIELDS,/s);
  assert.ok(sync.indexOf('const authority = materializeTravelportStaysReservationOperationInput') < sync.indexOf('SF_TRACE_ID_PATTERN.test'));

  assert.match(recovery, /const authority = materializeTravelportStaysReservationOperationInput\(\s*input,\s*RECOVERY_OPERATION_FIELDS,/s);
  assert.ok(recovery.indexOf('const authority = materializeTravelportStaysReservationOperationInput') < recovery.indexOf("boundedSingleLine(\n      authority.providerReservationReference"));
});

test('shared materializer freezes an allowlisted snapshot and sanitizes hostile accessors', async () => {
  const helper = await source('src/server/suppliers/travelport-stays-reservation-operation-input-authority.ts');

  assert.match(helper, /fields\.map\(\(field\) => \[field, input\[field\]\] as const\)/);
  assert.match(helper, /Object\.freeze\(Object\.fromEntries\(entries\)\)/);
  assert.match(helper, /catch \{\s*throw new HospitalitySupplierProviderError\('INVALID_REQUEST', failureMessage\);\s*\}/s);
  assert.doesNotMatch(helper, /throw error|error\.message/);
});

test('operation-input authority documentation keeps Travelport reservation activation closed', async () => {
  const doc = await source('docs/travelport-stays-reservation-operation-input-authority.md');

  assert.match(doc, /initial Create/i);
  assert.match(doc, /reviewed Create/i);
  assert.match(doc, /Booking\.com Sync/i);
  assert.match(doc, /known-locator recovery/i);
  assert.match(doc, /remains deliberately disabled/i);
  assert.match(doc, /PCI-safe FormOfPayment/i);
  assert.match(doc, /13034/);
});
