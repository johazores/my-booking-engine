import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');
const invoices = read('src/server/payments/hospitality-issued-invoice-read-service.ts');
const adjustments = read('src/server/payments/hospitality-issued-adjustment-note-read-service.ts');
const publicHistory = read('src/server/payments/public-issued-tax-invoice-service.ts');
const docs = read('docs/hospitality-tax-document-read-consistency.md');

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing source section: ${start}`);
  const endIndex = end ? source.indexOf(end, startIndex + start.length) : source.length;
  assert.notEqual(endIndex, -1, `Missing source section terminator: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('booking-scoped tax invoice history snapshots tenant booking authority count and page', () => {
  const source = section(invoices, 'export async function listHospitalityIssuedTaxInvoices', 'export async function listHospitalityIssuedTaxInvoicesForOrganization');
  assert.match(invoices, /permission: 'booking:read'/);
  assert.match(invoices, /permission: 'payment:read'/);
  assert.match(source, /await requireIssuedInvoiceReadAccess\(input\)/);
  assert.match(source, /db\.\$transaction\(async \(transaction\) =>/);
  assert.match(source, /transaction\.hospitalityBooking\.findFirst/);
  assert.match(source, /where: \{ id: input\.bookingId, organizationId: input\.organizationId \}/);
  assert.match(source, /transaction\.hospitalityIssuedInvoice\.count\(\{ where \}\)/);
  assert.match(source, /transaction\.hospitalityIssuedInvoice\.findMany/);
  assert.match(source, /const page = Math\.min\(requestedPage, totalPages\)/);
  assert.match(source, /isolationLevel: 'RepeatableRead'/);
  assert.doesNotMatch(source, /await db\.hospitalityIssuedInvoice\.(?:count|findMany)/);
});

test('organization tax invoice register snapshots count and clamped page', () => {
  const source = section(invoices, 'export async function listHospitalityIssuedTaxInvoicesForOrganization', 'export async function createHospitalityIssuedTaxInvoiceAccountingExport');
  assert.match(source, /db\.\$transaction\(async \(transaction\) =>/);
  assert.match(source, /transaction\.hospitalityIssuedInvoice\.count\(\{ where \}\)/);
  assert.match(source, /transaction\.hospitalityIssuedInvoice\.findMany/);
  assert.match(source, /orderBy: \[\{ issuedAt: 'desc' \}, \{ id: 'desc' \}\]/);
  assert.match(source, /const page = Math\.min\(requestedPage, totalPages\)/);
  assert.match(source, /isolationLevel: 'RepeatableRead'/);
});

test('organization adjustment-note register snapshots count and clamped page before legal authority validation', () => {
  const source = section(adjustments, 'export async function listHospitalityIssuedAdjustmentNotesForOrganization', 'export async function createHospitalityIssuedAdjustmentNoteAccountingExport');
  assert.match(source, /db\.\$transaction\(async \(transaction\) =>/);
  assert.match(source, /transaction\.hospitalityIssuedAdjustmentNote\.count\(\{ where \}\)/);
  assert.match(source, /transaction\.hospitalityIssuedAdjustmentNote\.findMany/);
  assert.match(source, /const page = Math\.min\(requestedPage, totalPages\)/);
  assert.match(source, /isolationLevel: 'RepeatableRead'/);
  const transactionEnd = source.indexOf("isolationLevel: 'RepeatableRead'");
  const authorityUse = source.indexOf('validateRowsWithAuthorities', transactionEnd);
  assert.ok(transactionEnd >= 0 && authorityUse > transactionEnd, 'legal authority validation must remain after the paginated snapshot read');
});

test('public capability history snapshots persisted ownership and both legal-document collections', () => {
  const source = section(publicHistory, 'export async function listPublicBookingIssuedTaxInvoices');
  assert.match(source, /verifyPublicBookingBookingCapability/);
  assert.match(source, /db\.\$transaction\(async \(transaction\) =>/);
  assert.match(source, /transaction\.publicBookingBookingOwnership\.findUnique/);
  assert.match(source, /transaction\.publicBookingPrincipal\.findFirst/);
  assert.match(source, /transaction\.hospitalityBooking\.findFirst/);
  assert.match(source, /transaction\.hospitalityIssuedInvoice\.count/);
  assert.match(source, /transaction\.hospitalityIssuedInvoice\.findMany/);
  assert.match(source, /transaction\.hospitalityIssuedAdjustmentNote\.count/);
  assert.match(source, /transaction\.hospitalityIssuedAdjustmentNote\.findMany/);
  assert.match(source, /take: PUBLIC_DOCUMENT_LIMIT/);
  assert.match(source, /isolationLevel: 'RepeatableRead'/);
  assert.match(source, /truncated: snapshot\.total > items\.length/);
  assert.match(source, /truncated: snapshot\.adjustmentTotal > adjustmentItems\.length/);
});

test('documentation keeps collection snapshots separate from complete legal authority', () => {
  assert.match(docs, /RepeatableRead/);
  assert.match(docs, /bookingId.*organizationId/s);
  assert.match(docs, /shared legal authority verifier/i);
  assert.match(docs, /Pagination is not legal completeness/);
  assert.match(docs, /never proves settlement, adjustment-chain completeness, refund authority, reconciliation completeness, or issuance eligibility/);
  assert.match(docs, /serializable\/advisory-lock\/idempotency boundaries/);
});
