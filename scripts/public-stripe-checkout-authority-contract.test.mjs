import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const service = read('src/server/payments/public-stripe-checkout-service.ts');
const writeScope = read('docs/public-stripe-checkout-write-scope.md');

test('Checkout preflight proves persisted authority before protected booking and prior-payment reads in one snapshot', () => {
  const functionIndex = service.indexOf('export async function createPublicStripeCheckoutSession');
  const transactionIndex = service.indexOf('db.$transaction(async (transaction)', functionIndex);
  const ownershipIndex = service.indexOf('transaction.publicBookingBookingOwnership.findUnique', transactionIndex);
  const principalIndex = service.indexOf('transaction.publicBookingPrincipal.findFirst', transactionIndex);
  const authorizationIndex = service.indexOf(
    'if (!ownership || ownership.principalId !== capability.principalId || !principal)',
    transactionIndex,
  );
  const bookingIndex = service.indexOf('transaction.hospitalityBooking.findFirst', authorizationIndex);
  const priorIndex = service.indexOf('transaction.paymentTransaction.findUnique', bookingIndex);
  const snapshotEnd = service.indexOf("{ isolationLevel: 'RepeatableRead' }", priorIndex);

  assert.ok(functionIndex >= 0);
  assert.ok(transactionIndex > functionIndex);
  assert.ok(ownershipIndex > transactionIndex);
  assert.ok(principalIndex > transactionIndex);
  assert.ok(authorizationIndex > ownershipIndex && authorizationIndex > principalIndex);
  assert.ok(bookingIndex > authorizationIndex);
  assert.ok(priorIndex > bookingIndex);
  assert.ok(snapshotEnd > priorIndex);
});

test('locked Checkout claim revalidates persisted and signed public authority before protected claim reads', () => {
  const claimIndex = service.indexOf('const claim = await db.$transaction(async (transaction) =>');
  const paymentLockIndex = service.indexOf('payment:', claimIndex);
  const bookingLockIndex = service.indexOf('hospitalityBookingMutationLockKey', paymentLockIndex);
  const claimNowIndex = service.indexOf('const claimAuthorityNow = input.now ?? new Date();', bookingLockIndex);
  const ownershipIndex = service.indexOf('transaction.publicBookingBookingOwnership.findUnique', claimNowIndex);
  const principalIndex = service.indexOf('transaction.publicBookingPrincipal.findFirst', ownershipIndex);
  const principalFreshnessIndex = service.indexOf('expiresAt: { gt: claimAuthorityNow }', principalIndex);
  const signedExpiryIndex = service.indexOf('capability.expiresAt.getTime() <= claimAuthorityNow.getTime()', principalFreshnessIndex);
  const protectedReadIndex = service.indexOf('const [existing, currentBooking] = await Promise.all([', signedExpiryIndex);
  const serializableIndex = service.indexOf("{ isolationLevel: 'Serializable' }", protectedReadIndex);
  const providerIndex = service.indexOf('stripe.provider.createPaymentSession({', serializableIndex);

  assert.ok(claimIndex >= 0);
  assert.ok(paymentLockIndex > claimIndex);
  assert.ok(bookingLockIndex > paymentLockIndex);
  assert.ok(claimNowIndex > bookingLockIndex);
  assert.ok(ownershipIndex > claimNowIndex);
  assert.ok(principalIndex > ownershipIndex);
  assert.ok(principalFreshnessIndex > principalIndex);
  assert.ok(signedExpiryIndex > principalFreshnessIndex);
  assert.ok(protectedReadIndex > signedExpiryIndex);
  assert.ok(serializableIndex > protectedReadIndex);
  assert.ok(providerIndex > serializableIndex);
  assert.match(service.slice(protectedReadIndex, serializableIndex), /now: claimAuthorityNow/);
  assert.match(service, /now: claim\.authorizedAt/);
});

test('same-key terminal races resolve before the generic booking payment-state gate', () => {
  const claimIndex = service.indexOf('const claim = await db.$transaction(async (transaction) =>');
  const succeededIndex = service.indexOf("existing.status === 'SUCCEEDED'", claimIndex);
  const failedIndex = service.indexOf("existing.status === 'FAILED'", succeededIndex);
  const paymentStateIndex = service.indexOf("currentBooking.paymentStatus !== 'UNPAID'", failedIndex);

  assert.ok(succeededIndex > claimIndex);
  assert.ok(failedIndex > succeededIndex);
  assert.ok(paymentStateIndex > failedIndex);
  assert.match(service.slice(succeededIndex, paymentStateIndex), /callProvider: false/);
  assert.match(service.slice(failedIndex, paymentStateIndex), /This Checkout attempt failed/);
});

test('expected tenant Stripe configuration failures stay behind the public unavailable boundary', () => {
  assert.match(service, /IntegrationUnavailableError/);
  assert.match(service, /StripeIntegrationConfigurationError/);
  assert.match(service, /async function loadPublicStripeCheckoutIntegration\(organizationId: string\)/);
  assert.match(
    service,
    /error instanceof IntegrationUnavailableError \|\| error instanceof StripeIntegrationConfigurationError/,
  );
  assert.match(service, /const stripe = await loadPublicStripeCheckoutIntegration\(branding\.id\)/);
});

test('write-scope documentation records snapshot, signed-expiry, retry-race and provider configuration authority', () => {
  assert.match(writeScope, /RepeatableRead/);
  assert.match(writeScope, /signed capability expiry/);
  assert.match(writeScope, /becomes `SUCCEEDED`/);
  assert.match(writeScope, /becomes `FAILED`/);
  assert.match(writeScope, /invalid stored Stripe configuration/);
});
