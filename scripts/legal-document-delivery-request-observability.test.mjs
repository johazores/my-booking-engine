import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const authenticatedRoutes = [
  ['app/api/invoices/hospitality/[document-number]/pdf/route.ts', 'hospitality-tax-invoice.pdf.download'],
  ['app/api/invoices/hospitality/adjustments/[document-number]/pdf/route.ts', 'hospitality-adjustment-note.pdf.download'],
  ['app/api/invoices/hospitality/accounting/route.ts', 'hospitality-tax-invoice.accounting-export'],
  ['app/api/invoices/hospitality/adjustments/accounting/route.ts', 'hospitality-adjustment-note.accounting-export'],
];

const publicRoutes = [
  ['app/api/public-bookings/[organization-slug]/hospitality/tax-invoices/route.ts', 'public-booking.tax-document-history.read'],
  ['app/api/public-bookings/[organization-slug]/hospitality/tax-invoices/[document-number]/pdf/route.ts', 'public-booking.tax-invoice.pdf.download'],
  ['app/api/public-bookings/[organization-slug]/hospitality/adjustment-notes/[document-number]/pdf/route.ts', 'public-booking.adjustment-note.pdf.download'],
];

const reconciliationRoute = read('app/invoices/reconciliation/run/route.ts');
const reconciliationPage = read('app/invoices/reconciliation/page.tsx');
const publicHttp = read('src/server/payments/public-tax-document-http.ts');

test('authenticated legal-document delivery attaches tenant scope only after server authority', () => {
  for (const [path, operation] of authenticatedRoutes) {
    const source = read(path);
    assert.match(source, /createRequestObservation\(request,/);
    assert.match(source, new RegExp(operation.replaceAll('.', '\\.')));
    assert.match(source, /let organizationId: string \| undefined;/);
    assert.match(source, /if \((?:apiContext|context)\.response\) return finish\((?:apiContext|context)\.response\);/);
    assert.match(source, /organizationId = (?:apiContext|context)\.organizationId;/);
    assert.match(source, /observation\.finish\(response, \{ organizationId \}\)/);
    assert.doesNotMatch(source, /scope:\s*\{[^}]*documentNumber/);
    assert.doesNotMatch(source, /console\.(?:log|info|warn|error)/);
  }
});

test('public tax-document history and PDF delivery stay capability-safe and tenant-free in request logs', () => {
  for (const [path, operation] of publicRoutes) {
    const source = read(path);
    assert.match(source, /createRequestObservation\(request,/);
    assert.match(source, new RegExp(operation.replaceAll('.', '\\.')));
    assert.match(source, /const finish = \(response: Response\) => observation\.finish\(response\);/);
    assert.doesNotMatch(source, /observation\.finish\([^\n]*organizationId/);
    assert.doesNotMatch(source, /observation\.finish\([^\n]*organizationSlug/);
    assert.doesNotMatch(source, /observation\.finish\([^\n]*bookingCapability/);
    assert.doesNotMatch(source, /observation\.finish\([^\n]*documentNumber/);
    assert.doesNotMatch(source, /console\.(?:log|info|warn|error)/);
  }
});

test('public tax-document bodies fail closed as validation errors instead of malformed-json server failures', () => {
  assert.match(publicHttp, /try \{/);
  assert.match(publicHttp, /await request\.json\(\)/);
  assert.match(publicHttp, /catch \{/);
  assert.match(publicHttp, /return null;/);
  for (const [path] of publicRoutes) {
    const source = read(path);
    assert.match(source, /readPublicTaxDocumentBookingCapability\(request\)/);
    assert.match(source, /bookingCapability === null/);
    assert.match(source, /invalid-request/);
  }
});

test('reconciliation uses redirect-aware rejected and failed outcomes without trusting tenant input', () => {
  assert.match(reconciliationRoute, /hospitality-tax-document\.reconciliation\.run/);
  assert.match(reconciliationRoute, /let organizationId: string \| undefined;/);
  assert.match(reconciliationRoute, /if \(context\.response\) \{/);
  assert.match(reconciliationRoute, /responseFailureOutcome\(context\.response\)/);
  assert.match(reconciliationRoute, /organizationId = context\.organizationId;/);
  assert.match(reconciliationRoute, /'rejected'/);
  assert.match(reconciliationRoute, /'failed'/);
  assert.match(reconciliationRoute, /\/invoices\/reconciliation\?error=internal/);
  assert.doesNotMatch(reconciliationRoute, /console\.(?:log|info|warn|error)/);
  assert.match(reconciliationPage, /internal: 'The reconciliation run could not complete because of a server error\./);
});
