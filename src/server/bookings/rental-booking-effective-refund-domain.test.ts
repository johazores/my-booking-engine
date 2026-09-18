import assert from 'node:assert/strict';
import test from 'node:test';

import type { BookingSettlementTransaction } from '../payments/payment-settlement-domain.ts';
import {
  deriveRentalBookingEffectiveSettlement,
  type AppliedRentalBookingCommercialAmendmentSettlementEvidence,
  type RentalBookingEffectiveRefundEvidence,
} from './rental-booking-effective-settlement-domain.ts';
import {
  buildRentalBookingEffectiveRefundIdempotencyKey,
  buildRentalBookingEffectiveRefundRequestFingerprint,
  deriveRentalBookingEffectiveRefundPlan,
} from './rental-booking-effective-refund-domain.ts';

const payment = (reference = 'PAY-1', amountMinor = 10_000n): BookingSettlementTransaction => ({
  kind: 'OFFLINE_PAYMENT',
  status: 'SUCCEEDED',
  providerCode: 'manual',
  providerReference: reference,
  sourceProviderReference: null,
  currency: 'AUD',
  amountMinor,
});

const applied = (
  direction: 'ADDITIONAL_CHARGE' | 'REFUND',
  deltaMinor = 2_000n,
): AppliedRentalBookingCommercialAmendmentSettlementEvidence => ({
  id: 'amendment-1',
  direction,
  currency: 'AUD',
  beforeTotalMinor: 10_000n,
  afterTotalMinor: direction === 'ADDITIONAL_CHARGE' ? 12_000n : 8_000n,
  deltaMinor,
  settlementRows: [{
    purpose: 'ADJUSTMENT',
    kind: direction === 'ADDITIONAL_CHARGE' ? 'OFFLINE_PAYMENT' : 'REFUND',
    status: 'SUCCEEDED',
    providerCode: 'manual',
    providerReference: direction === 'ADDITIONAL_CHARGE' ? 'AMEND-PAY-1' : 'AMEND-REF-1',
    sourceProviderReference: direction === 'ADDITIONAL_CHARGE' ? null : 'PAY-1',
    currency: 'AUD',
    amountMinor: deltaMinor,
  }],
});

const postRefund = (
  sourceLedger: 'BOOKING_PRICE' | 'COMMERCIAL_AMENDMENT',
  reference: string,
  source: string,
  amountMinor: bigint,
): RentalBookingEffectiveRefundEvidence => ({
  sourceLedger,
  status: 'SUCCEEDED',
  providerCode: 'manual',
  providerReference: reference,
  sourceProviderReference: source,
  currency: 'AUD',
  amountMinor,
});

test('applied increase unwinds amendment charge before original booking-price money', () => {
  const settlement = deriveRentalBookingEffectiveSettlement({
    originalBookingTotalMinor: 10_000n,
    currency: 'AUD',
    originalTransactions: [payment()],
    appliedAmendment: applied('ADDITIONAL_CHARGE'),
  });
  assert.equal(settlement.reconciled, true);
  if (!settlement.reconciled) return;
  assert.deepEqual(settlement.nextRefundSource, {
    sourceLedger: 'COMMERCIAL_AMENDMENT',
    providerCode: 'manual',
    providerReference: 'AMEND-PAY-1',
    sourceKind: 'OFFLINE_PAYMENT',
    currency: 'AUD',
    refundableMinor: 2_000n,
  });

  const afterChargeRefund = deriveRentalBookingEffectiveSettlement({
    originalBookingTotalMinor: 10_000n,
    currency: 'AUD',
    originalTransactions: [payment()],
    appliedAmendment: applied('ADDITIONAL_CHARGE'),
    postApplyRefunds: [postRefund('COMMERCIAL_AMENDMENT', 'POST-REF-1', 'AMEND-PAY-1', 2_000n)],
  });
  assert.equal(afterChargeRefund.reconciled, true);
  if (!afterChargeRefund.reconciled) return;
  assert.equal(afterChargeRefund.currentNetSettledMinor, 10_000n);
  assert.equal(afterChargeRefund.amendmentChargeRefundRemainingMinor, 0n);
  assert.equal(afterChargeRefund.nextRefundSource?.sourceLedger, 'BOOKING_PRICE');
  assert.equal(afterChargeRefund.nextRefundSource?.providerReference, 'PAY-1');
});

test('post-apply booking-price refunds reconcile after applied increase', () => {
  const settlement = deriveRentalBookingEffectiveSettlement({
    originalBookingTotalMinor: 10_000n,
    currency: 'AUD',
    originalTransactions: [payment()],
    appliedAmendment: applied('ADDITIONAL_CHARGE'),
    postApplyRefunds: [
      postRefund('COMMERCIAL_AMENDMENT', 'POST-REF-1', 'AMEND-PAY-1', 2_000n),
      postRefund('BOOKING_PRICE', 'POST-REF-2', 'PAY-1', 4_000n),
    ],
  });
  assert.equal(settlement.reconciled, true);
  if (!settlement.reconciled) return;
  assert.equal(settlement.currentNetSettledMinor, 6_000n);
  assert.equal(settlement.bookingPriceRefundRemainingMinor, 6_000n);
  assert.equal(settlement.nextRefundSource?.providerReference, 'PAY-1');
  assert.equal(settlement.nextRefundSource?.refundableMinor, 6_000n);
});

test('applied decrease composes its original-source refund with later post-apply refunds', () => {
  const settlement = deriveRentalBookingEffectiveSettlement({
    originalBookingTotalMinor: 10_000n,
    currency: 'AUD',
    originalTransactions: [payment()],
    appliedAmendment: applied('REFUND'),
    postApplyRefunds: [postRefund('BOOKING_PRICE', 'POST-REF-1', 'PAY-1', 3_000n)],
  });
  assert.equal(settlement.reconciled, true);
  if (!settlement.reconciled) return;
  assert.equal(settlement.currentNetSettledMinor, 5_000n);
  assert.equal(settlement.bookingPriceRefundRemainingMinor, 5_000n);
  assert.equal(settlement.nextRefundSource?.providerReference, 'PAY-1');
  assert.equal(settlement.nextRefundSource?.refundableMinor, 5_000n);
});

test('fails closed on wrong-ledger, wrong-source, duplicate, or over-refund evidence', () => {
  const wrongLedger = deriveRentalBookingEffectiveSettlement({
    originalBookingTotalMinor: 10_000n,
    currency: 'AUD',
    originalTransactions: [payment()],
    appliedAmendment: applied('REFUND'),
    postApplyRefunds: [postRefund('COMMERCIAL_AMENDMENT', 'POST-REF-1', 'PAY-1', 1_000n)],
  });
  assert.equal(wrongLedger.reconciled, false);

  const wrongSource = deriveRentalBookingEffectiveSettlement({
    originalBookingTotalMinor: 10_000n,
    currency: 'AUD',
    originalTransactions: [payment()],
    appliedAmendment: applied('ADDITIONAL_CHARGE'),
    postApplyRefunds: [postRefund('COMMERCIAL_AMENDMENT', 'POST-REF-1', 'WRONG', 1_000n)],
  });
  assert.equal(wrongSource.reconciled, false);

  const duplicate = deriveRentalBookingEffectiveSettlement({
    originalBookingTotalMinor: 10_000n,
    currency: 'AUD',
    originalTransactions: [payment()],
    appliedAmendment: applied('ADDITIONAL_CHARGE'),
    postApplyRefunds: [
      postRefund('COMMERCIAL_AMENDMENT', 'POST-REF-1', 'AMEND-PAY-1', 1_000n),
      postRefund('COMMERCIAL_AMENDMENT', 'POST-REF-1', 'AMEND-PAY-1', 500n),
    ],
  });
  assert.equal(duplicate.reconciled, false);

  const overRefund = deriveRentalBookingEffectiveSettlement({
    originalBookingTotalMinor: 10_000n,
    currency: 'AUD',
    originalTransactions: [payment()],
    appliedAmendment: applied('ADDITIONAL_CHARGE'),
    postApplyRefunds: [postRefund('COMMERCIAL_AMENDMENT', 'POST-REF-1', 'AMEND-PAY-1', 2_001n)],
  });
  assert.equal(overRefund.reconciled, false);
});

test('refund plan binds requested amount to the current authoritative source', () => {
  const settlement = deriveRentalBookingEffectiveSettlement({
    originalBookingTotalMinor: 10_000n,
    currency: 'AUD',
    originalTransactions: [payment()],
    appliedAmendment: applied('ADDITIONAL_CHARGE'),
  });
  const plan = deriveRentalBookingEffectiveRefundPlan({ settlement, requestedAmountMinor: 1_500n });
  assert.equal(plan.planned, true);
  if (!plan.planned) return;
  assert.equal(plan.sourceLedger, 'COMMERCIAL_AMENDMENT');
  assert.equal(plan.sourceProviderReference, 'AMEND-PAY-1');
  assert.equal(plan.sourceRefundableMinor, 2_000n);
  assert.equal(plan.effectiveRefundableMinor, 12_000n);

  const tooLarge = deriveRentalBookingEffectiveRefundPlan({ settlement, requestedAmountMinor: 2_001n });
  assert.equal(tooLarge.planned, false);
});

test('refund idempotency and request fingerprints are deterministic and commercial-source-sensitive', () => {
  const key = buildRentalBookingEffectiveRefundIdempotencyKey({
    bookingId: 'booking-1',
    amendmentId: 'amendment-1',
    reference: 'REF-1',
  });
  assert.equal(key, buildRentalBookingEffectiveRefundIdempotencyKey({
    bookingId: 'booking-1',
    amendmentId: 'amendment-1',
    reference: 'REF-1',
  }));
  assert.match(key, /^rental-effective-refund:[a-f0-9]{48}$/);

  const base = {
    organizationId: 'org-1',
    bookingId: 'booking-1',
    amendmentId: 'amendment-1',
    idempotencyKey: key,
    sourceLedger: 'BOOKING_PRICE' as const,
    providerCode: 'manual',
    providerReference: 'REF-1',
    sourceProviderReference: 'PAY-1',
    currency: 'AUD',
    amountMinor: 1_000n,
  };
  const fingerprint = buildRentalBookingEffectiveRefundRequestFingerprint(base);
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
  assert.notEqual(
    fingerprint,
    buildRentalBookingEffectiveRefundRequestFingerprint({
      ...base,
      sourceLedger: 'COMMERCIAL_AMENDMENT',
      sourceProviderReference: 'AMEND-PAY-1',
    }),
  );
});
