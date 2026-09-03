import assert from 'node:assert/strict';
import test from 'node:test';

import {
  stripeCommercialAmendmentRecoveryFingerprint,
  stripeCommercialAmendmentRecoveryOperationKey,
} from './booking-commercial-amendment-stripe-recovery-domain.ts';
import {
  assertStripeCommercialAmendmentRecoveryWebhookIdentity,
} from './booking-commercial-amendment-stripe-recovery-webhook-domain.ts';

const bookingId = '11111111-1111-4111-8111-111111111111';
const amendmentId = '22222222-2222-4222-8222-222222222222';

function capture() {
  const providerReference = 'pi_recovery_capture_1';
  const operation = 'CAPTURE_COMPENSATION' as const;
  return {
    bookingId,
    commercialAmendmentId: amendmentId,
    idempotencyKey: stripeCommercialAmendmentRecoveryOperationKey({
      bookingId,
      amendmentId,
      operation,
      providerReference,
    }),
    requestFingerprint: stripeCommercialAmendmentRecoveryFingerprint({
      bookingId,
      amendmentId,
      operation,
      currency: 'USD',
      amountMinor: 2500n,
      providerReference,
    }),
    kind: 'CAPTURE' as const,
    providerReference,
    sourceProviderReference: null,
    currency: 'USD',
    amountMinor: 2500n,
  };
}

function refund() {
  const sourceProviderReference = 'pi_recovery_source_1';
  const operation = 'COMPENSATION_REFUND' as const;
  return {
    bookingId,
    commercialAmendmentId: amendmentId,
    idempotencyKey: stripeCommercialAmendmentRecoveryOperationKey({
      bookingId,
      amendmentId,
      operation,
      providerReference: sourceProviderReference,
    }),
    requestFingerprint: stripeCommercialAmendmentRecoveryFingerprint({
      bookingId,
      amendmentId,
      operation,
      currency: 'USD',
      amountMinor: 1800n,
      providerReference: sourceProviderReference,
    }),
    kind: 'REFUND' as const,
    providerReference: 're_recovery_refund_1',
    sourceProviderReference,
    currency: 'USD',
    amountMinor: 1800n,
  };
}

test('recovery capture webhook identity binds the exact PaymentIntent, money, and deterministic operation key', () => {
  assert.deepEqual(assertStripeCommercialAmendmentRecoveryWebhookIdentity(capture()), {
    operation: 'CAPTURE_COMPENSATION',
    providerReference: 'pi_recovery_capture_1',
  });
});

test('recovery refund webhook identity binds the exact settlement source instead of the refund reference', () => {
  assert.deepEqual(assertStripeCommercialAmendmentRecoveryWebhookIdentity(refund()), {
    operation: 'COMPENSATION_REFUND',
    providerReference: 'pi_recovery_source_1',
  });
});

test('recovery webhook identity fails closed on idempotency or fingerprint drift', () => {
  assert.throws(() => assertStripeCommercialAmendmentRecoveryWebhookIdentity({
    ...capture(),
    idempotencyKey: `ca-stripe-recovery-capture-${'0'.repeat(64)}`,
  }), /operation identity/i);
  assert.throws(() => assertStripeCommercialAmendmentRecoveryWebhookIdentity({
    ...refund(),
    requestFingerprint: 'f'.repeat(64),
  }), /operation identity/i);
});

test('recovery refund webhook identity refuses missing source attribution', () => {
  assert.throws(() => assertStripeCommercialAmendmentRecoveryWebhookIdentity({
    ...refund(),
    sourceProviderReference: null,
  }), /source attribution/i);
});
