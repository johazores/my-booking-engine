import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const service = read('src/server/payments/public-issued-tax-invoice-service.ts');
const taxRoute = read('app/api/public-bookings/[organization-slug]/hospitality/tax-invoices/[document-number]/pdf/route.ts');
const adjustmentRoute = read('app/api/public-bookings/[organization-slug]/hospitality/adjustment-notes/[document-number]/pdf/route.ts');

test('public PDF routes use exact capability-owned document reads instead of bounded history search', () => {
  assert.match(taxRoute, /getPublicBookingIssuedTaxInvoice/);
  assert.match(adjustmentRoute, /getPublicBookingIssuedAdjustmentNote/);
  assert.doesNotMatch(taxRoute, /listPublicBookingIssuedTaxInvoices/);
  assert.doesNotMatch(adjustmentRoute, /listPublicBookingIssuedTaxInvoices/);
  assert.doesNotMatch(taxRoute, /\.items\.find/);
  assert.doesNotMatch(adjustmentRoute, /\.items\.find/);
});

test('public PDF routes never double-decode Next.js document-number params', () => {
  for (const [route, documentType] of [
    [taxRoute, 'tax invoice'],
    [adjustmentRoute, 'adjustment note'],
  ]) {
    assert.match(
      route,
      /const documentNumber = rawDocumentNumber\.trim\(\)\.toUpperCase\(\);/,
      `${documentType} must normalize the framework-decoded route param directly`,
    );
    assert.doesNotMatch(
      route,
      /decodeURIComponent\s*\(/,
      `${documentType} must not decode an already-decoded route param again`,
    );
  }
});

test('exact public document reads authorize before document lookup and remain tenant-booking scoped', () => {
  for (const functionName of [
    'getPublicBookingIssuedTaxInvoice',
    'getPublicBookingIssuedAdjustmentNote',
  ]) {
    const start = service.indexOf(`export async function ${functionName}`);
    assert.notEqual(start, -1, `${functionName} must exist`);
    const nextExport = service.indexOf('\nexport async function ', start + 1);
    const source = service.slice(start, nextExport === -1 ? service.length : nextExport);
    const authorization = source.indexOf('await assertPublicDocumentAuthority(transaction, authority)');
    const documentLookup = source.indexOf('documentNumber: input.documentNumber');
    assert.ok(authorization >= 0, `${functionName} must prove persisted public authority`);
    assert.ok(documentLookup > authorization, `${functionName} must authorize before document lookup`);
    assert.match(source, /organizationId: authority\.organizationId/);
    assert.match(source, /bookingId: authority\.bookingId/);
  }

  assert.match(service, /\{ isolationLevel: 'RepeatableRead' \}/);
  assert.match(service, /validatePersistedInvoice\(row\)/);
  assert.match(service, /validateHospitalityIssuedAdjustmentNoteRowsInTransaction/);
});
