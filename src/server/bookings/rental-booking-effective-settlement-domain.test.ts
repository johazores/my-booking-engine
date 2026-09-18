import assert from 'node:assert/strict';
import test from 'node:test';

import type { BookingSettlementTransaction } from '../payments/payment-settlement-domain.ts';
import {
  deriveRentalBookingEffectiveSettlement,
  type AppliedRentalBookingCommercialAmendmentSettlementEvidence,
} from './rental-booking-effective-settlement-domain.ts';

const payment = (reference = 'PAY-1', amountMinor = 10_000n): BookingSettlementTransaction => ({
  kind: 'OFFLINE_PAYMENT',
  status: 'SUCCEEDED',
  providerCode: 'manual',
  providerReference: reference,
  sourceProviderReference: null,
  currency: 'AUD',
  amountMinor,
});

const refund = (reference: string, source: string, amountMinor: bigint): BookingSettlementTransaction => ({
  kind: 'REFUND',
  status: 'SUCCEEDED',
  providerCode: 'manual',
  providerReference: reference,
  sourceProviderReference: source,
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

test('mirrors original booking-price settlement when no commercial amendment is applied', () => {
  const result = deriveRentalBookingEffectiveSettlement({
    originalBookingTotalMinor: 10_000n,
    currency: 'AUD',
    originalTransactions: [payment()],
  });
  assert.equal(result.reconciled, true);
  if (!result.reconciled) return;
  assert.equal(result.effectiveAcceptedTotalMinor, 10_000n);
  assert.equal(result.currentNetSettledMinor, 10_000n);
  assert.equal(result.bookingPriceRefundRemainingMinor, 10_000n);
  assert.equal(result.amendmentChargeRefundRemainingMinor, 0n);
  assert.equal(result.fullyFunded, true);
  assert.equal(result.appliedAmendment, null);
});

test('combines an applied additional charge with immutable original booking-price settlement', () => {
  const result = deriveRentalBookingEffectiveSettlement({
    originalBookingTotalMinor: 10_000n,
    currency: 'AUD',
    originalTransactions: [payment()],
    appliedAmendment: applied('ADDITIONAL_CHARGE'),
  });
  assert.equal(result.reconciled, true);
  if (!result.reconciled) return;
  assert.equal(result.effectiveAcceptedTotalMinor, 12_000n);
  assert.equal(result.currentNetSettledMinor, 12_000n);
  assert.equal(result.bookingPriceRefundRemainingMinor, 10_000n);
  assert.equal(result.amendmentChargeRefundRemainingMinor, 2_000n);
  assert.equal(result.cancellationRefundRemainingMinor, 12_000n);
  assert.equal(result.amendmentNetEffectMinor, 2_000n);
});

test('applied decrease consumes the retained original payment source before later refund planning', () => {
  const result = deriveRentalBookingEffectiveSettlement({
    originalBookingTotalMinor: 10_000n,
    currency: 'AUD',
    originalTransactions: [payment()],
    appliedAmendment: applied('REFUND'),
  });
  assert.equal(result.reconciled, true);
  if (!result.reconciled) return;
  assert.equal(result.effectiveAcceptedTotalMinor, 8_000n);
  assert.equal(result.originalBookingNetSettledMinor, 10_000n);
  assert.equal(result.currentNetSettledMinor, 8_000n);
  assert.equal(result.bookingPriceRefundRemainingMinor, 8_000n);
  assert.equal(result.amendmentChargeRefundRemainingMinor, 0n);
  assert.equal(result.amendmentNetEffectMinor, -2_000n);
});

test('later original-source refund evidence composes with an applied decrease without double-refunding the source', () => {
  const result = deriveRentalBookingEffectiveSettlement({
    originalBookingTotalMinor: 10_000n,
    currency: 'AUD',
    originalTransactions: [payment(), refund('REF-1', 'PAY-1', 3_000n)],
    appliedAmendment: applied('REFUND'),
  });
  assert.equal(result.reconciled, true);
  if (!result.reconciled) return;
  assert.equal(result.currentNetSettledMinor, 5_000n);
  assert.equal(result.bookingPriceRefundRemainingMinor, 5_000n);
  assert.equal(result.cancellationRefundRemainingMinor, 5_000n);
  assert.equal(result.fullyFunded, false);
  assert.equal(result.fullyRefunded, false);
});

test('fails closed when retained amendment evidence is compensated, arithmetically invalid, or over-refunds a source', () => {
  const compensated = applied('ADDITIONAL_CHARGE');
  const compensatedResult = deriveRentalBookingEffectiveSettlement({
    originalBookingTotalMinor: 10_000n,
    currency: 'AUD',
    originalTransactions: [payment()],
    appliedAmendment: {
      ...compensated,
      settlementRows: [
        ...compensated.settlementRows,
        {
          purpose: 'COMPENSATION',
          kind: 'REFUND',
          status: 'SUCCEEDED',
          providerCode: 'manual',
          providerReference: 'AMEND-COMP-1',
          sourceProviderReference: 'AMEND-PAY-1',
          currency: 'AUD',
          amountMinor: 2_000n,
        },
      ],
    },
  });
  assert.equal(compensatedResult.reconciled, false);

  const arithmeticResult = deriveRentalBookingEffectiveSettlement({
    originalBookingTotalMinor: 10_000n,
    currency: 'AUD',
    originalTransactions: [payment()],
    appliedAmendment: { ...applied('ADDITIONAL_CHARGE'), afterTotalMinor: 12_001n },
  });
  assert.equal(arithmeticResult.reconciled, false);

  const overRefundResult = deriveRentalBookingEffectiveSettlement({
    originalBookingTotalMinor: 10_000n,
    currency: 'AUD',
    originalTransactions: [payment(), refund('REF-1', 'PAY-1', 9_000n)],
    appliedAmendment: applied('REFUND'),
  });
  assert.equal(overRefundResult.reconciled, false);
});
