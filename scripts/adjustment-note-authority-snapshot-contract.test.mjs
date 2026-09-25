import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const authority = readFileSync('src/server/payments/hospitality-issued-adjustment-note-authority-service.ts', 'utf8');
const commercial = readFileSync('src/server/payments/hospitality-commercial-amendment-adjustment-chain-read-service.ts', 'utf8');
const staffRead = readFileSync('src/server/payments/hospitality-issued-adjustment-note-read-service.ts', 'utf8');
const docs = readFileSync('docs/adjustment-note-authority-snapshot.md', 'utf8');

function section(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `Missing source section: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `Missing source section terminator: ${end}`);
  return source.slice(from, to);
}

test('shared adjustment authority uses the caller transaction for database evidence', () => {
  const source = section(
    authority,
    'export async function validateHospitalityIssuedAdjustmentNoteRowsInTransaction',
    'export async function validateHospitalityIssuedAdjustmentNoteRows(input',
  );
  assert.match(source, /verifyCancellationAuthorities\(input\.transaction/);
  assert.match(source, /verifyCancellationAfterAmendmentAuthorities\(input\.transaction/);
  assert.match(source, /verifyCommercialAuthorities\(input\.transaction/);
  assert.doesNotMatch(source, /\bdb\./);

  const cancellation = section(
    authority,
    'async function verifyCancellationAuthorities',
    'async function verifyCancellationAfterAmendmentAuthorities',
  );
  assert.match(cancellation, /transaction\.hospitalityIssuedInvoice\.findMany/);
  assert.match(cancellation, /transaction\.paymentTransaction\.findMany/);
});

test('commercial chain groups share one snapshot', () => {
  const inTransaction = section(
    commercial,
    'export async function verifyHospitalityCommercialAmendmentAdjustmentRowsInTransaction',
    'export async function verifyHospitalityCommercialAmendmentAdjustmentRows(input',
  );
  assert.match(inTransaction, /transaction: input\.transaction/);
  assert.doesNotMatch(inTransaction, /\bdb\./);

  const wrapper = commercial.slice(commercial.indexOf('export async function verifyHospitalityCommercialAmendmentAdjustmentRows(input'));
  assert.match(wrapper, /db\.\$transaction/);
  assert.match(wrapper, /isolationLevel: 'RepeatableRead'/);
});

test('compatibility authority wrapper preserves RepeatableRead', () => {
  const wrapper = authority.slice(authority.indexOf('export async function validateHospitalityIssuedAdjustmentNoteRows(input'));
  assert.match(wrapper, /db\.\$transaction/);
  assert.match(wrapper, /validateHospitalityIssuedAdjustmentNoteRowsInTransaction/);
  assert.match(wrapper, /isolationLevel: 'RepeatableRead'/);
  assert.match(docs, /caller-owned PostgreSQL transaction/i);
  assert.match(docs, /Tenant scope remains mandatory/i);
});


test('authenticated adjustment-note reads keep selected rows and authority evidence in one snapshot', () => {
  const list = section(
    staffRead,
    'export async function listHospitalityIssuedAdjustmentNotesForOrganization',
    'export async function createHospitalityIssuedAdjustmentNoteAccountingExport',
  );
  assert.match(list, /db\.\$transaction/);
  assert.match(list, /validateRowsWithAuthoritiesInTransaction\(transaction, input\.organizationId, rows\)/);
  assert.doesNotMatch(list, /validateRowsWithAuthorities\(input\.organizationId/);

  const accounting = section(
    staffRead,
    'export async function createHospitalityIssuedAdjustmentNoteAccountingExport',
    'export async function getHospitalityIssuedAdjustmentNoteDocument',
  );
  assert.match(accounting, /db\.\$transaction/);
  assert.match(accounting, /transaction\.hospitalityIssuedAdjustmentNote\.findMany/);
  assert.match(accounting, /validateRowsWithAuthoritiesInTransaction\(transaction, input\.organizationId, rows\)/);

  const detail = section(
    staffRead,
    'export async function getHospitalityIssuedAdjustmentNoteDocument',
    'export async function getHospitalityIssuedCancellationAdjustmentNoteDocument',
  );
  assert.match(detail, /db\.\$transaction/);
  assert.match(detail, /transaction\.hospitalityIssuedAdjustmentNote\.findFirst/);
  assert.match(detail, /validateRowsWithAuthoritiesInTransaction\(transaction, input\.organizationId, \[row\]\)/);
});
