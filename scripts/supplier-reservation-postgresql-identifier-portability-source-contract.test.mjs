import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const storedName = (name) => Buffer.from(name, 'utf8').subarray(0, 63).toString('utf8');

const authorityMigration = read('prisma/migrations/20260906075200_supplier-reservation-authority-binding/migration.sql');
const confirmationMigration = read('prisma/migrations/20260906112500_supplier-reservation-confirmation-evidence/migration.sql');
const portabilityMigration = read('prisma/migrations/20260922073000-supplier-reservation-identifier-portability/migration.sql');
const supplierSchema = read('prisma/hospitality-supplier-reservations.prisma');

const expectedConstraintRenames = [
  ['hospitality_supplier_reservation_operations_credential_version_', 'supplier_reservation_ops_credential_version_check'],
  ['hospitality_supplier_reservation_operations_request_fingerprint', 'supplier_reservation_ops_request_fingerprint_check'],
  ['hospitality_supplier_reservation_operations_offer_fingerprint_c', 'supplier_reservation_ops_offer_fingerprint_check'],
  ['hospitality_supplier_reservation_operations_terms_fingerprint_c', 'supplier_reservation_ops_terms_fingerprint_check'],
  ['hospitality_supplier_reservation_operations_payload_fingerprint', 'supplier_reservation_ops_payload_fingerprint_check'],
  ['hospitality_supplier_reservation_operations_provider_reference_', 'supplier_reservation_ops_provider_reference_state_check'],
  ['hospitality_supplier_reservation_operations_supplier_confirmati', 'supplier_reservation_ops_confirmation_reference_check'],
  ['hospitality_supplier_reservation_operations_provider_recovery_r', 'supplier_reservation_ops_recovery_reference_check'],
  ['hospitality_supplier_reservation_operations_failure_state_contr', 'supplier_reservation_ops_failure_state_check'],
  ['hospitality_supplier_reservation_operations_review_acceptance_c', 'supplier_reservation_ops_review_acceptance_check'],
  ['hospitality_supplier_reservation_operations_selection_machine_r', 'supplier_reservation_ops_selection_token_check'],
  ['hospitality_supplier_reservation_operations_provider_machine_re', 'supplier_reservation_ops_provider_token_check'],
  ['hospitality_supplier_reservation_attempt_provider_request_clock', 'supplier_reservation_attempt_provider_clock_check'],
  ['hospitality_supplier_reservation_attempt_provider_evidence_chec', 'supplier_reservation_attempt_provider_evidence_check'],
  ['hospitality_supplier_reservation_attempt_review_failure_code_ch', 'supplier_reservation_attempt_review_failure_check'],
  ['hospitality_supplier_reservation_attempts_provider_correlation_', 'supplier_reservation_attempt_correlation_control_check'],
  ['hospitality_supplier_reservation_review_acceptance_history_cont', 'supplier_review_acceptance_history_contract_check'],
];

const expectedIndexRenames = [
  ['hospitality_supplier_reservation_operations_org_provider_refere', 'supplier_reservation_ops_provider_ref_key'],
  ['hospitality_supplier_reservation_operations_org_status_created_', 'supplier_reservation_ops_status_created_idx'],
  ['hospitality_supplier_reservation_operations_org_integration_sta', 'supplier_reservation_ops_integration_status_idx'],
  ['hospitality_supplier_reservation_attempts_org_reservation_seque', 'supplier_reservation_attempts_sequence_key'],
  ['hospitality_supplier_reservation_attempts_org_reservation_start', 'supplier_reservation_attempts_reservation_started_idx'],
  ['hospitality_supplier_reservation_attempts_org_status_started_id', 'supplier_reservation_attempts_status_started_idx'],
];

const expectedMappedNames = [
  'hospitality_supplier_reservation_operations_integration_fkey',
  'hospitality_supplier_reservation_operations_id_org_key',
  'hospitality_supplier_reservation_operations_org_idempotency_key',
  'supplier_reservation_ops_provider_ref_key',
  'supplier_reservation_ops_status_created_idx',
  'supplier_reservation_ops_integration_status_idx',
  'hospitality_supplier_reservation_attempts_reservation_fkey',
  'supplier_reservation_attempts_sequence_key',
  'supplier_reservation_attempts_reservation_started_idx',
  'supplier_reservation_attempts_status_started_idx',
];

test('authority-binding migration avoids request-fingerprint truncation collision', () => {
  const baseName = 'hospitality_supplier_reservation_operations_request_fingerprint_check';
  const oldVersionName = 'hospitality_supplier_reservation_operations_request_fingerprint_version_check';
  const compactVersionName = 'supplier_reservation_ops_request_fingerprint_version_check';

  assert.equal(storedName(baseName), storedName(oldVersionName));
  assert.equal(Buffer.byteLength(storedName(baseName)), 63);
  assert.ok(Buffer.byteLength(compactVersionName) <= 63);
  assert.notEqual(storedName(baseName), compactVersionName);
  assert.match(authorityMigration, new RegExp(`ADD CONSTRAINT "${compactVersionName}"`));
  assert.doesNotMatch(authorityMigration, new RegExp(`ADD CONSTRAINT "${oldVersionName}"`));
});

test('confirmation migration removes provider-reference collision before replacement checks', () => {
  const oldName = 'hospitality_supplier_reservation_operations_provider_reference_check';
  const stateName = 'hospitality_supplier_reservation_operations_provider_reference_state_check';
  const oldFormatName = 'hospitality_supplier_reservation_operations_provider_reference_format_check';
  const compactFormatName = 'supplier_reservation_ops_provider_reference_format_check';

  assert.equal(storedName(oldName), storedName(stateName));
  assert.equal(storedName(oldName), storedName(oldFormatName));
  assert.equal(Buffer.byteLength(storedName(oldName)), 63);
  assert.ok(Buffer.byteLength(compactFormatName) <= 63);
  assert.notEqual(storedName(stateName), compactFormatName);

  const dropOffset = confirmationMigration.indexOf(`DROP CONSTRAINT "${oldName}"`);
  const stateOffset = confirmationMigration.indexOf(`ADD CONSTRAINT "${stateName}"`);
  assert.ok(dropOffset >= 0, 'old provider-reference check must be dropped');
  assert.ok(stateOffset > dropOffset, 'old provider-reference check must be dropped before the state replacement is added');
  assert.match(confirmationMigration, new RegExp(`ADD CONSTRAINT "${compactFormatName}"`));
  assert.doesNotMatch(confirmationMigration, new RegExp(`ADD CONSTRAINT "${oldFormatName}"`));
});

test('portability migration renames every known live truncated supplier identifier to a bounded unique name', () => {
  const constraintRenames = [...portabilityMigration.matchAll(/RENAME CONSTRAINT "([^"]+)" TO "([^"]+)"/g)]
    .map((match) => [match[1], match[2]]);
  const indexRenames = [...portabilityMigration.matchAll(/ALTER INDEX "([^"]+)"\s+RENAME TO "([^"]+)"/g)]
    .map((match) => [match[1], match[2]]);

  assert.deepEqual(constraintRenames, expectedConstraintRenames);
  assert.deepEqual(indexRenames, expectedIndexRenames);

  const allRenames = [...constraintRenames, ...indexRenames];
  assert.equal(allRenames.length, 23);
  for (const [source, destination] of allRenames) {
    assert.equal(Buffer.byteLength(source), 63, `${source} must be the exact stored PostgreSQL identifier`);
    assert.ok(Buffer.byteLength(destination) <= 63, `${destination} must fit the PostgreSQL identifier limit`);
  }
  assert.equal(new Set(allRenames.map(([, destination]) => destination)).size, allRenames.length);
  assert.doesNotMatch(portabilityMigration, /\b(?:CREATE|DROP|INSERT|UPDATE|DELETE)\b/i);
});

test('supplier Prisma fragment maps explicit database relation and index authority', () => {
  for (const name of expectedMappedNames) {
    assert.ok(Buffer.byteLength(name) <= 63, `${name} must fit the PostgreSQL identifier limit`);
    assert.match(supplierSchema, new RegExp(`map: "${name}"`));
  }
});

test('supplier relation mappings preserve tenant-bound composite authority', () => {
  assert.match(
    supplierSchema,
    /integration\s+Integration\s+@relation\(fields: \[integrationId, organizationId\], references: \[id, organizationId\], onDelete: Restrict, map: "hospitality_supplier_reservation_operations_integration_fkey"\)/,
  );
  assert.match(
    supplierSchema,
    /reservation\s+HospitalitySupplierReservationOperation\s+@relation\(fields: \[reservationId, organizationId\], references: \[id, organizationId\], onDelete: Restrict, map: "hospitality_supplier_reservation_attempts_reservation_fkey"\)/,
  );
});
