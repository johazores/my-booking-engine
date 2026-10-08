import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../app/book/[organization-slug]/public-booking-flow.tsx', import.meta.url), 'utf8');
const capabilitySource = await readFile(new URL('../app/book/[organization-slug]/public-booking-document-capability.ts', import.meta.url), 'utf8');

test('payment recovery remounts when the active booking capability changes', () => {
  assert.match(source, /usePublicBookingDocumentCapability\(organizationSlug\)/);
  assert.match(source, /key=\{activeBookingCapability \?\? 'none'\}/);
  assert.match(source, /activeBookingCapability !== current\.bookingCapability/);
});

test('stale payment-status and checkout results cannot change the active booking', () => {
  assert.match(source, /generation === statusGeneration\.current && isActive\(current\.bookingCapability\)/);
  assert.match(source, /const result = await readJson\(response\) as PaymentRecoveryStatus;\s*if \(!isCurrent\(\)\) return;/);
  assert.match(source, /if \(!isActive\(capability\)\) return;/);
  assert.match(source, /if \(isActive\(capability\)\) await checkStatus\(activeRecovery\);/);
});

test('recovery authority wins over an obsolete legacy receipt fallback', () => {
  assert.ok(capabilitySource.indexOf('const recovery = recoveryCapability(organizationSlug);') < capabilitySource.indexOf('const legacyReceipt = window.sessionStorage.getItem'));
});

test('new recovery authority is persisted before notifying document views', () => {
  assert.match(source, /storeRecovery\(organizationSlug, recovery\);\s*storePublicBookingDocumentCapability\(organizationSlug, bookingCapability\);/);
});

test('late initial Checkout responses cannot redirect a different booking', () => {
  assert.match(source, /readPublicBookingDocumentCapability\(organizationSlug\) !== bookingCapability\) return;/);
});

test('an older offer card cannot show stale payment status or recovery actions', () => {
  assert.match(source, /const paymentIsCurrent = paymentBookingCapability !== null && activeBookingCapability === paymentBookingCapability/);
  assert.match(source, /setPaymentBookingCapability\(bookingCapability\);\s*storeRecovery\(organizationSlug, recovery\)/);
  assert.match(source, /stage === 'payment' && !paymentIsCurrent/);
  assert.match(source, /stage === 'payment' && paymentIsCurrent/);
});
