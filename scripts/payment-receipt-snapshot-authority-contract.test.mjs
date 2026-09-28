import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const publicReceipt = read('src/server/payments/public-payment-receipt-service.ts');
const staffReceipt = read('src/server/payments/payment-receipt-service.ts');
const publicStripeStatus = read('src/server/payments/public-stripe-payment-status-service.ts');

test('public receipt proves persisted customer authority before protected receipt evidence reads in one snapshot', () => {
  const functionIndex = publicReceipt.indexOf('export async function getPublicBookingPaymentReceipt');
  const transactionIndex = publicReceipt.indexOf('db.$transaction(async (transaction)', functionIndex);
  const ownershipIndex = publicReceipt.indexOf('transaction.publicBookingBookingOwnership.findUnique', transactionIndex);
  const principalIndex = publicReceipt.indexOf('transaction.publicBookingPrincipal.findFirst', transactionIndex);
  const authorizationIndex = publicReceipt.indexOf(
    'if (!ownership || ownership.principalId !== capability.principalId || !principal)',
    transactionIndex,
  );
  const bookingIndex = publicReceipt.indexOf('transaction.hospitalityBooking.findFirst', authorizationIndex);
  const paymentHistoryIndex = publicReceipt.indexOf('readHospitalityPaymentReceiptHistory({', authorizationIndex);

  assert.ok(functionIndex >= 0);
  assert.ok(transactionIndex > functionIndex);
  assert.ok(ownershipIndex > transactionIndex);
  assert.ok(principalIndex > transactionIndex);
  assert.ok(authorizationIndex > ownershipIndex);
  assert.ok(authorizationIndex > principalIndex);
  assert.ok(bookingIndex > authorizationIndex);
  assert.ok(paymentHistoryIndex > authorizationIndex);
  assert.match(publicReceipt, /transaction,\n\s+organizationId: branding\.id,\n\s+bookingId: capability\.bookingId/);
  assert.match(publicReceipt, /\}, \{ isolationLevel: 'RepeatableRead' \}\)/);
});

test('staff receipt reads booking and payment history from one repeatable-read snapshot after permission', () => {
  const permissionIndex = staffReceipt.indexOf('await requireOrganizationPermission({');
  const transactionIndex = staffReceipt.indexOf('db.$transaction(async (transaction)', permissionIndex);

  assert.ok(permissionIndex >= 0);
  assert.ok(transactionIndex > permissionIndex);
  assert.match(staffReceipt, /transaction\.organization\.findFirst/);
  assert.match(staffReceipt, /transaction\.hospitalityBooking\.findFirst/);
  assert.match(staffReceipt, /readHospitalityPaymentReceiptHistory\(\{\n\s+transaction,/);
  assert.match(staffReceipt, /\}, \{ isolationLevel: 'RepeatableRead' \}\)/);
});

test('public Stripe recovery verifies persisted customer authority before booking and provider state in one snapshot', () => {
  const functionIndex = publicStripeStatus.indexOf('export async function getPublicStripePaymentStatus');
  const transactionIndex = publicStripeStatus.indexOf('db.$transaction(async (transaction)', functionIndex);
  const ownershipIndex = publicStripeStatus.indexOf('transaction.publicBookingBookingOwnership.findUnique', transactionIndex);
  const principalIndex = publicStripeStatus.indexOf('transaction.publicBookingPrincipal.findFirst', transactionIndex);
  const authorizationIndex = publicStripeStatus.indexOf(
    'if (!ownership || ownership.principalId !== capability.principalId || !principal)',
    transactionIndex,
  );
  const bookingIndex = publicStripeStatus.indexOf('transaction.hospitalityBooking.findFirst', authorizationIndex);
  const paymentIndex = publicStripeStatus.indexOf('transaction.paymentTransaction.findFirst', bookingIndex);
  const checkoutIndex = publicStripeStatus.indexOf('transaction.paymentCheckoutSession.findFirst', bookingIndex);

  assert.ok(transactionIndex > functionIndex);
  assert.ok(authorizationIndex > ownershipIndex);
  assert.ok(authorizationIndex > principalIndex);
  assert.ok(bookingIndex > authorizationIndex);
  assert.ok(paymentIndex > bookingIndex);
  assert.ok(checkoutIndex > bookingIndex);
  const latestPaymentRead = publicStripeStatus.slice(paymentIndex, checkoutIndex);
  assert.doesNotMatch(latestPaymentRead, /currency: true/);
  assert.doesNotMatch(latestPaymentRead, /amountMinor: true/);
  assert.match(publicStripeStatus, /\}, \{ isolationLevel: 'RepeatableRead' \}\)/);
});
