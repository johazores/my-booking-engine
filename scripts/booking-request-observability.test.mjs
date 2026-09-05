import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const authenticatedBookingWrites = [
  ['app/api/bookings/hospitality/holds/route.ts', 'booking.hospitality-hold.create'],
  ['app/api/bookings/hospitality/confirm/route.ts', 'booking.hospitality-confirmation.create'],
  ['app/api/bookings/hospitality/[booking-id]/cancel/route.ts', 'booking.hospitality-cancellation.apply'],
  ['app/api/bookings/hospitality/[booking-id]/guests/route.ts', 'booking.hospitality-guests.update'],
  ['app/api/bookings/hospitality/[booking-id]/modify/route.ts', 'booking.hospitality-commercial-modification.apply'],
  ['app/api/bookings/hospitality/[booking-id]/modify/preview/route.ts', 'booking.hospitality-commercial-modification.preview'],
  ['app/api/bookings/hospitality/[booking-id]/reschedule/route.ts', 'booking.hospitality-reschedule.apply'],
  ['app/api/bookings/hospitality/[booking-id]/commercial-amendments/route.ts', 'booking.hospitality-commercial-amendment.prepare'],
  ['app/api/bookings/hospitality/[booking-id]/commercial-amendments/[amendment-id]/apply/route.ts', 'booking.hospitality-commercial-amendment.apply'],
  ['app/api/bookings/hospitality/[booking-id]/commercial-amendments/[amendment-id]/cancel/route.ts', 'booking.hospitality-commercial-amendment.cancel'],
];

const authenticatedBookingReads = [
  ['app/api/bookings/hospitality/route.ts', 'booking.hospitality.list'],
  ['app/api/bookings/hospitality/[booking-id]/modify/route.ts', 'booking.hospitality-commercial-modification.options.read'],
  ['app/api/bookings/hospitality/[booking-id]/commercial-amendments/route.ts', 'booking.hospitality-commercial-amendment.current.read'],
  ['app/api/bookings/hospitality/[booking-id]/commercial-amendments/[amendment-id]/route.ts', 'booking.hospitality-commercial-amendment.read'],
];

const publicBookingRoutes = [
  ['app/api/public-bookings/[organization-slug]/hospitality/holds/route.ts', ['public-booking.hospitality-hold.create', 'public-booking.hospitality-hold.release']],
  ['app/api/public-bookings/[organization-slug]/hospitality/quote/route.ts', ['public-booking.hospitality-quote.read']],
  ['app/api/public-bookings/[organization-slug]/hospitality/confirmation/route.ts', ['public-booking.hospitality-confirmation.create']],
];

function assertOperation(source, operation) {
  assert.match(source, new RegExp(`createRequestObservation\\(request, \\{ operation: '${operation.replaceAll('.', '\\.')}' \\}\\)`));
  assert.doesNotMatch(source, /console\.(?:log|info|warn|error)/);
}

test('authenticated hospitality booking writes attach tenant log scope only after booking API authorization', () => {
  for (const [path, operation] of authenticatedBookingWrites) {
    const source = route(path);
    assertOperation(source, operation);
    const operationIndex = source.indexOf(`operation: '${operation}'`);
    const sourceAfterOperation = source.slice(operationIndex);
    const contextIndex = sourceAfterOperation.indexOf('await requireHospitalityBookingApiContext(request, { write: true })');
    const tenantScopeIndex = sourceAfterOperation.indexOf('organizationId = context.organizationId;');
    assert.ok(contextIndex >= 0, `${path} must require the hospitality write context`);
    assert.ok(tenantScopeIndex > contextIndex, `${path} must not attach tenant log scope before authorization`);
    assert.match(sourceAfterOperation, /if \(context\.response\) return finish\(context\.response\);/);
    assert.match(sourceAfterOperation, /catch \(error\) \{\n\s+return finish\(hospitalityBookingApiError\(error\)\);/);
    assert.doesNotMatch(sourceAfterOperation, /observation\.finish\([^\n]+(?:bookingId|amendmentId|idempotencyKey|change|request\.url)/);
    assert.doesNotMatch(sourceAfterOperation, /bookingReference:/);
  }
});

test('authenticated hospitality booking reads correlate after tenant authorization without logging selectors', () => {
  for (const [path, operation] of authenticatedBookingReads) {
    const source = route(path);
    assertOperation(source, operation);
    const operationIndex = source.indexOf(`operation: '${operation}'`);
    const sourceAfterOperation = source.slice(operationIndex);
    const contextIndex = sourceAfterOperation.indexOf('await requireHospitalityBookingApiContext(request)');
    const tenantScopeIndex = sourceAfterOperation.indexOf('organizationId = context.organizationId;');
    assert.ok(contextIndex >= 0, `${path} must require the hospitality read context`);
    assert.ok(tenantScopeIndex > contextIndex, `${path} must not attach tenant log scope before authorization`);
    assert.match(sourceAfterOperation, /if \(context\.response\) return finish\(context\.response\);/);
    assert.match(sourceAfterOperation, /catch \(error\) \{\n\s+return finish\(hospitalityBookingApiError\(error\)\);/);
    assert.doesNotMatch(sourceAfterOperation, /observation\.finish\([^\n]+(?:bookingId|amendmentId|page|pageSize|request\.url)/);
    assert.doesNotMatch(sourceAfterOperation, /bookingReference:/);
  }
});

test('public hold, quote, and confirmation boundaries correlate without copying public authority or customer data into log scope', () => {
  for (const [path, operations] of publicBookingRoutes) {
    const source = route(path);
    for (const operation of operations) assertOperation(source, operation);
    assert.doesNotMatch(source, /organizationId:/);
    assert.doesNotMatch(source, /bookingReference:/);
    assert.doesNotMatch(source, /provider:/);
    assert.doesNotMatch(source, /observation\.finish\([^\n]+(?:organizationSlug|capability|requestKey|expectedPricingFingerprint|customer|guests|addonSelections|request\.url)/);
    assert.match(source, /return finish\(errorResponse\(error\)\);/);
  }
});

test('public write origin rejections and validation responses still pass through the correlation boundary', () => {
  for (const path of [
    'app/api/public-bookings/[organization-slug]/hospitality/holds/route.ts',
    'app/api/public-bookings/[organization-slug]/hospitality/quote/route.ts',
    'app/api/public-bookings/[organization-slug]/hospitality/confirmation/route.ts',
  ]) {
    const source = route(path);
    assert.match(source, /return finish\(Response\.json\(\{ error: 'invalid-origin' \}/);
    assert.match(source, /return finish\(Response\.json\(\{ error: 'invalid-request' \}/);
  }
});

test('public hold create and release use independent request observations', () => {
  const source = route('app/api/public-bookings/[organization-slug]/hospitality/holds/route.ts');
  const matches = source.match(/createRequestObservation\(request, \{ operation: 'public-booking\.hospitality-hold\.(?:create|release)' \}\)/g) ?? [];
  assert.equal(matches.length, 2);
  assert.match(source, /export async function POST/);
  assert.match(source, /export async function DELETE/);
});
