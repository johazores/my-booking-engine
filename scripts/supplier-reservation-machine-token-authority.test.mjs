import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('provider-neutral reservation machine tokens use one exact bounded control-free guard', () => {
  const helper = source('src/server/suppliers/hospitality-supplier-machine-token.ts');
  const domain = source('src/server/suppliers/hospitality-supplier-reservation-domain.ts');
  const submission = source('src/server/suppliers/hospitality-supplier-reservation-submission-authority.ts');
  const recovery = source('src/server/suppliers/hospitality-supplier-reservation-recovery-evidence-service.ts');
  const confirmation = source('src/server/suppliers/hospitality-supplier-reservation-confirmation-evidence.ts');

  assert.match(helper, /\[\\u0000-\\u001f\\u007f\]/);
  assert.match(helper, /value\.trim\(\) === value/);
  assert.match(helper, /value\.length <= maxLength/);

  for (const text of [domain, submission, recovery, confirmation]) {
    assert.match(text, /isExactHospitalitySupplierMachineToken/);
  }
  assert.doesNotMatch(domain, /const normalized = value\.trim\(\);[\s\S]{0,180}MAX_CORRELATION_LENGTH/);
  assert.doesNotMatch(submission, /const normalized = value\.trim\(\)/);
  assert.doesNotMatch(recovery, /const normalized = value\.trim\(\)/);
});

test('idempotency keys and immutable selection references are no longer normalized into aliases', () => {
  const domain = source('src/server/suppliers/hospitality-supplier-reservation-domain.ts');

  assert.match(
    domain,
    /typeof value !== 'string' \|\| !IDEMPOTENCY_KEY_PATTERN\.test\(value\)/,
  );
  assert.doesNotMatch(
    domain,
    /normalizeHospitalitySupplierReservationIdempotencyKey[\s\S]{0,220}value\.trim\(\)/,
  );
  assert.match(
    domain,
    /normalizeOpaqueReference[\s\S]{0,220}isExactHospitalitySupplierMachineToken\(value, MAX_REFERENCE_LENGTH\)/,
  );
});

test('database constraints reject control-bearing durable supplier reservation evidence', () => {
  const migration = source(
    'prisma/migrations/20260911112400_supplier-reservation-machine-token-authority/migration.sql',
  );

  assert.match(migration, /selection_machine_reference_check/);
  assert.match(migration, /"supplierPropertyReference" !~ '\[\[:cntrl:\]\]'/);
  assert.match(migration, /"supplierOfferReference" !~ '\[\[:cntrl:\]\]'/);
  for (const column of [
    'providerReservationReference',
    'supplierConfirmationReference',
    'providerRecoveryReference',
    'lastProviderCorrelationId',
  ]) {
    assert.match(migration, new RegExp(`"${column}"[^\\n]+!~ '\\[\\[:cntrl:\\]\\]'`));
  }
  assert.match(migration, /hospitality_supplier_reservation_attempts_provider_correlation_control_check/);
  assert.match(migration, /"providerCorrelationId" !~ '\[\[:cntrl:\]\]'/);
});
