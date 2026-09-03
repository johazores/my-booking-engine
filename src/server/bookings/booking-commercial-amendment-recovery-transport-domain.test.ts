import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveHospitalityCommercialAmendmentRecoveryTransportState,
  hospitalityCommercialAmendmentRecoveryCheckoutAttemptRequestKey,
} from './booking-commercial-amendment-recovery-transport-domain.ts';

const base = { reason: 'test' } as const;

test('expired terminal recovery is presented as recovered', () => {
  assert.equal(deriveHospitalityCommercialAmendmentRecoveryTransportState({ decision: { ...base, state: 'TERMINAL', status: 'EXPIRED' }, checkoutClaimState: 'NONE' }), 'RECOVERED');
});

test('non-expired terminal states remain terminal', () => {
  assert.equal(deriveHospitalityCommercialAmendmentRecoveryTransportState({ decision: { ...base, state: 'TERMINAL', status: 'APPLIED' }, checkoutClaimState: 'NONE' }), 'TERMINAL');
});

test('restored settlement is ready for atomic recovery close', () => {
  assert.equal(deriveHospitalityCommercialAmendmentRecoveryTransportState({ decision: { ...base, state: 'READY_TO_EXPIRE', netSettledMinor: 1000n }, checkoutClaimState: 'NONE' }), 'READY_TO_CLOSE');
});

test('Stripe compensation charge requires customer Checkout', () => {
  assert.equal(deriveHospitalityCommercialAmendmentRecoveryTransportState({ decision: { ...base, state: 'COMPENSATE', operation: 'ADDITIONAL_CHARGE', providerCode: 'stripe', currency: 'USD', amountMinor: 500n }, checkoutClaimState: 'NONE' }), 'CHECKOUT_REQUIRED');
});

test('an unresolved internal Checkout claim is resumable with the same server attempt identity', () => {
  assert.equal(deriveHospitalityCommercialAmendmentRecoveryTransportState({ decision: { ...base, state: 'WAIT_FOR_PROVIDER' }, checkoutClaimState: 'INTERNAL_CLAIM' }), 'CHECKOUT_RESUME_REQUIRED');
});

test('a bound Checkout Session requires provider status reconciliation', () => {
  assert.equal(deriveHospitalityCommercialAmendmentRecoveryTransportState({ decision: { ...base, state: 'WAIT_FOR_PROVIDER' }, checkoutClaimState: 'CHECKOUT_SESSION' }), 'CHECKOUT_PENDING');
});

test('unrelated provider ambiguity is not misclassified as a Checkout claim', () => {
  assert.equal(deriveHospitalityCommercialAmendmentRecoveryTransportState({ decision: { ...base, state: 'WAIT_FOR_PROVIDER' }, checkoutClaimState: 'OTHER_PROVIDER_REFERENCE' }), 'WAIT_FOR_PROVIDER');
  assert.equal(deriveHospitalityCommercialAmendmentRecoveryTransportState({ decision: { ...base, state: 'WAIT_FOR_PROVIDER' }, checkoutClaimState: 'NONE' }), 'WAIT_FOR_PROVIDER');
});

test('provider-side recovery operations remain server recovery work instead of fake Checkout actions', () => {
  assert.equal(deriveHospitalityCommercialAmendmentRecoveryTransportState({ decision: { ...base, state: 'RELEASE_AUTHORIZATION', providerCode: 'stripe', providerReference: 'pi_test', currency: 'USD', amountMinor: 500n }, checkoutClaimState: 'NONE' }), 'RECOVERY_REQUIRED');
});

test('not-expired and conflict decisions preserve their blocking semantics', () => {
  assert.equal(deriveHospitalityCommercialAmendmentRecoveryTransportState({ decision: { ...base, state: 'NOT_EXPIRED' }, checkoutClaimState: 'NONE' }), 'NOT_EXPIRED');
  assert.equal(deriveHospitalityCommercialAmendmentRecoveryTransportState({ decision: { ...base, state: 'CONFLICT' }, checkoutClaimState: 'NONE' }), 'CONFLICT');
});

test('Checkout attempt request keys are stable per definitive-failure ordinal', () => {
  assert.equal(hospitalityCommercialAmendmentRecoveryCheckoutAttemptRequestKey(0), 'staff-recovery-checkout-attempt-1');
  assert.equal(hospitalityCommercialAmendmentRecoveryCheckoutAttemptRequestKey(2), 'staff-recovery-checkout-attempt-3');
  assert.throws(() => hospitalityCommercialAmendmentRecoveryCheckoutAttemptRequestKey(-1), /non-negative safe integer/);
  assert.throws(() => hospitalityCommercialAmendmentRecoveryCheckoutAttemptRequestKey(1.5), /non-negative safe integer/);
});
