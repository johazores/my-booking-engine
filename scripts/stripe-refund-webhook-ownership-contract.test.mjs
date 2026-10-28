import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const source = (relativePath) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

const domain = source('src/server/payments/stripe-webhook-domain.ts');
const ingest = source('src/server/payments/stripe-webhook-service.ts');
const normal = source('src/server/payments/stripe-refund-lifecycle-service.ts');
const amendment = source('src/server/bookings/hospitality-booking-commercial-amendment-stripe-refund-lifecycle-service.ts');
const amendmentFinalizer = source('src/server/bookings/hospitality-booking-commercial-amendment-stripe-webhook-service.ts');
const recoveryFinalizer = source('src/server/bookings/hospitality-booking-commercial-amendment-stripe-recovery-webhook-service.ts');

test('signed Stripe refund snapshots retain canonical tenant and booking metadata', () => {
  assert.match(domain, /const metadata = refund\.metadata/);
  assert.match(domain, /const metadataOrganizationId = optionalMetadataUuid\(metadata\?\.sf_organization_id\)/);
  assert.match(domain, /const metadataBookingId = optionalMetadataUuid\(metadata\?\.sf_booking_id\)/);
  assert.match(domain, /organizationId: metadataOrganizationId/);
  assert.match(domain, /bookingId: metadataBookingId/);
  assert.match(domain, /UUID_PATTERN\.test\(value\)/);
  assert.match(domain, /export function isStripeWebhookRefundOwnedBy/);
  assert.match(domain, /refund\.organizationId === organizationId/);
  assert.match(domain, /refund\.bookingId !== null/);
  assert.match(domain, /refund\.bookingId === bookingId/);
});

test('normal refund ingestion rejects unowned signed evidence before settlement-source lookup', () => {
  const refundIndex = ingest.indexOf('if (event.refund) {');
  const missingIndex = ingest.indexOf('refund-missing-sf-metadata', refundIndex);
  const tenantIndex = ingest.indexOf('refund-tenant-metadata-mismatch', refundIndex);
  const bookingIndex = ingest.indexOf('const bookingId = event.refund.bookingId;', refundIndex);
  const sourceIndex = ingest.indexOf('const settlementSource =', refundIndex);
  const pendingIndex = ingest.indexOf('const pendingRefunds =', refundIndex);
  assert.ok(refundIndex >= 0 && missingIndex > refundIndex && tenantIndex > missingIndex);
  assert.ok(bookingIndex > tenantIndex && sourceIndex > bookingIndex && pendingIndex > sourceIndex);
  assert.match(ingest, /if \(!isStripeWebhookRefundOwnedBy\(event\.refund, input\.organizationId\)\)/);
  assert.match(ingest, /bookingId,\s*commercialAmendmentId: null,\s*providerCode: STRIPE_PROVIDER_CODE,\s*providerReference: event\.refund\.paymentIntentReference/);
  assert.match(ingest, /foreignSettlementSource \? 'refund-booking-metadata-mismatch' : 'refund-source-settlement-unavailable'/);
});

test('every downstream refund lifecycle/finalizer rechecks signed tenant and selected booking', () => {
  for (const [name, body] of [
    ['normal lifecycle', normal],
    ['amendment lifecycle', amendment],
  ]) {
    assert.match(body, /!event\.refund \|\| !isStripeWebhookRefundOwnedBy\(event\.refund, input\.organizationId\)/, name);
    assert.match(body, /isStripeWebhookRefundOwnedBy\(event\.refund, input\.organizationId, refund\.bookingId\)/, name);
    assert.ok(body.indexOf('isStripeWebhookRefundOwnedBy(event.refund, input.organizationId, refund.bookingId)') < body.indexOf('const stripe = await loadStripePaymentIntegration'), name);
  }

  for (const [name, body] of [
    ['amendment finalizer', amendmentFinalizer],
    ['recovery finalizer', recoveryFinalizer],
  ]) {
    assert.match(body, /event\.refund && !isStripeWebhookRefundOwnedBy\(event\.refund, input\.organizationId\)/, name);
    const refundIndex = body.indexOf('const providerRefund = input.event.refund!;');
    const tenantIndex = body.indexOf('isStripeWebhookRefundOwnedBy(providerRefund, input.organizationId)', refundIndex);
    const bookingIndex = body.indexOf('isStripeWebhookRefundOwnedBy(providerRefund, input.organizationId, selected.bookingId)', refundIndex);
    const lockIndex = body.indexOf(name === 'recovery finalizer' ? 'await lockRecoveryBooking({' : 'await input.transaction.$queryRaw', refundIndex);
    assert.ok(refundIndex >= 0 && tenantIndex > refundIndex && bookingIndex > tenantIndex && lockIndex > bookingIndex, name);
  }
});
