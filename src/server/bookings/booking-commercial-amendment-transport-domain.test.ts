import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveHospitalityCommercialAmendmentTransportState } from './booking-commercial-amendment-transport-domain.ts';

test('maps manual execution to a real external settlement recording action', () => {
  assert.equal(deriveHospitalityCommercialAmendmentTransportState({
    state: 'EXECUTE', operation: 'ADDITIONAL_CHARGE', providerCode: 'manual', currency: 'USD', amountMinor: 1200n,
  }), 'MANUAL_SETTLEMENT_REQUIRED');
});

test('maps Stripe refunds to the server-owned refund executor', () => {
  assert.equal(deriveHospitalityCommercialAmendmentTransportState({
    state: 'EXECUTE', operation: 'REFUND', providerCode: 'stripe', sourceProviderReference: 'pi_1', sourceKind: 'CAPTURE', currency: 'USD', amountMinor: 500n, sourceRefundableMinor: 900n, bookingRefundableMinor: 900n, refundableSourceCount: 1,
  }), 'STRIPE_REFUND_REQUIRED');
});

test('does not pretend Stripe additional charges are ready without customer authorization transport', () => {
  assert.equal(deriveHospitalityCommercialAmendmentTransportState({
    state: 'EXECUTE', operation: 'ADDITIONAL_CHARGE', providerCode: 'stripe', currency: 'USD', amountMinor: 1200n,
  }), 'STRIPE_CUSTOMER_AUTHORIZATION_REQUIRED');
});

test('preserves provider waiting, apply, recovery, expiry, and terminal states', () => {
  assert.equal(deriveHospitalityCommercialAmendmentTransportState({ state: 'WAIT_FOR_PROVIDER', reason: 'pending' }), 'WAIT_FOR_PROVIDER');
  assert.equal(deriveHospitalityCommercialAmendmentTransportState({ state: 'READY_TO_APPLY' }), 'READY_TO_APPLY');
  assert.equal(deriveHospitalityCommercialAmendmentTransportState({ state: 'RECOVERY_REQUIRED', reason: 'expired after money' }), 'RECOVERY_REQUIRED');
  assert.equal(deriveHospitalityCommercialAmendmentTransportState({ state: 'EXPIRED', reason: 'no money moved' }), 'EXPIRED');
  assert.equal(deriveHospitalityCommercialAmendmentTransportState({ state: 'TERMINAL', status: 'APPLIED', reason: 'done' }), 'APPLIED');
  assert.equal(deriveHospitalityCommercialAmendmentTransportState({ state: 'TERMINAL', status: 'CANCELLED', reason: 'cancelled' }), 'CANCELLED');
});

test('maps conflicts and defensive terminal fallback to conflict', () => {
  assert.equal(deriveHospitalityCommercialAmendmentTransportState({ state: 'CONFLICT', reason: 'drift' }), 'CONFLICT');
});
