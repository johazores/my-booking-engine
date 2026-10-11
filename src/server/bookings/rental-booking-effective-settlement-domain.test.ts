import assert from 'node:assert/strict';
import test from 'node:test';

import type { BookingSettlementTransaction } from '../payments/payment-settlement-domain.ts';
import { deriveRentalPaymentSettlement } from '../payments/rental-payment-domain.ts';
import {
  deriveRentalBookingEffectiveSettlement,
  type AppliedRentalBookingCommercialAmendmentSettlementEvidence,
  type RentalBookingEffectiveRefundEvidence,
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

test('rental settlement projections reject malformed booking money without coercion', () => {
  for (const bookingTotalMinor of ['10000', 10_000, null, undefined]) {
    const result = deriveRentalPaymentSettlement({
      bookingTotalMinor: bookingTotalMinor as unknown as bigint,
      currency: 'AUD',
      transactions: [payment()],
    });
    assert.equal(result.reconciled, false);
  }
});

test('effective rental settlement rejects malformed money and amendment identity without throwing', () => {
  for (const originalBookingTotalMinor of ['10000', 10_000, null, undefined]) {
    const result = deriveRentalBookingEffectiveSettlement({
      originalBookingTotalMinor: originalBookingTotalMinor as unknown as bigint,
      currency: 'AUD',
      originalTransactions: [payment()],
    });
    assert.equal(result.reconciled, false);
  }
  const baseline = applied('ADDITIONAL_CHARGE');
  for (const amendment of [
    { ...baseline, id: null as unknown as string },
    { ...baseline, direction: 'UNKNOWN' as unknown as 'ADDITIONAL_CHARGE' },
    { ...baseline, afterTotalMinor: '12000' as unknown as bigint },
    { ...baseline, deltaMinor: 2_000 as unknown as bigint },
  ]) {
    const result = deriveRentalBookingEffectiveSettlement({
      originalBookingTotalMinor: 10_000n,
      currency: 'AUD',
      originalTransactions: [payment()],
      appliedAmendment: amendment,
    });
    assert.equal(result.reconciled, false);
  }
});

test('post-apply rental refund evidence rejects unsafe identities and non-bigint money', () => {
  const baseline = {
    sourceLedger: 'COMMERCIAL_AMENDMENT' as const,
    status: 'SUCCEEDED' as const,
    providerCode: 'manual',
    providerReference: 'AMEND-REF-1',
    sourceProviderReference: 'AMEND-PAY-1',
    currency: 'AUD',
    amountMinor: 500n,
  };
  for (const row of [
    { ...baseline, amountMinor: '500' as unknown as bigint },
    { ...baseline, amountMinor: 500 as unknown as bigint },
    { ...baseline, providerReference: null as unknown as string },
    { ...baseline, sourceProviderReference: null as unknown as string },
    { ...baseline, providerReference: ' padded ' },
    { ...baseline, providerReference: 'bad\u0000ref' },
    { ...baseline, sourceProviderReference: 'bad\u0085source' },
    { ...baseline, providerReference: 'sf_claim_unsettled' },
    { ...baseline, sourceProviderReference: 'sf_claim_source' },
  ]) {
    const result = deriveRentalBookingEffectiveSettlement({
      originalBookingTotalMinor: 10_000n,
      currency: 'AUD',
      originalTransactions: [payment()],
      appliedAmendment: applied('ADDITIONAL_CHARGE'),
      postApplyRefunds: [row],
    });
    assert.equal(result.reconciled, false);
  }
  const valid = deriveRentalBookingEffectiveSettlement({
    originalBookingTotalMinor: 10_000n,
    currency: 'AUD',
    originalTransactions: [payment()],
    appliedAmendment: applied('ADDITIONAL_CHARGE'),
    postApplyRefunds: [baseline],
  });
  assert.equal(valid.reconciled, true);
});

test('effective rental refunds cannot reuse successful original or amendment provider identities', () => {
  const base: RentalBookingEffectiveRefundEvidence = {
    sourceLedger: 'COMMERCIAL_AMENDMENT',
    status: 'SUCCEEDED',
    providerCode: 'manual',
    providerReference: 'POST-REF-1',
    sourceProviderReference: 'AMEND-PAY-1',
    currency: 'AUD',
    amountMinor: 500n,
  };
  for (const providerReference of ['PAY-1', 'AMEND-PAY-1']) {
    const result = deriveRentalBookingEffectiveSettlement({
      originalBookingTotalMinor: 10_000n,
      currency: 'AUD',
      originalTransactions: [payment()],
      appliedAmendment: applied('ADDITIONAL_CHARGE'),
      postApplyRefunds: [{ ...base, providerReference }],
    });
    assert.equal(result.reconciled, false);
  }
  const amendmentRefundCollision = deriveRentalBookingEffectiveSettlement({
    originalBookingTotalMinor: 10_000n,
    currency: 'AUD',
    originalTransactions: [payment()],
    appliedAmendment: applied('REFUND'),
    postApplyRefunds: [{
      ...base,
      sourceLedger: 'BOOKING_PRICE',
      providerReference: 'AMEND-REF-1',
      sourceProviderReference: 'PAY-1',
    }],
  });
  assert.equal(amendmentRefundCollision.reconciled, false);
});

test('effective rental settlement rejects missing post-apply rows and malformed amendment history', () => {
  const invalidRow = deriveRentalBookingEffectiveSettlement({
    originalBookingTotalMinor: 10_000n,
    currency: 'AUD',
    originalTransactions: [payment()],
    appliedAmendment: applied('ADDITIONAL_CHARGE'),
    postApplyRefunds: [null as unknown as RentalBookingEffectiveRefundEvidence],
  });
  assert.equal(invalidRow.reconciled, false);

  const invalidHistory = deriveRentalBookingEffectiveSettlement({
    originalBookingTotalMinor: 10_000n,
    currency: 'AUD',
    originalTransactions: [payment()],
    appliedAmendment: {
      ...applied('ADDITIONAL_CHARGE'),
      settlementRows: null as unknown as AppliedRentalBookingCommercialAmendmentSettlementEvidence['settlementRows'],
    },
  });
  assert.equal(invalidHistory.reconciled, false);
});

test('effective rental settlement rejects malformed history collections without throwing', () => {
  const base = {
    originalBookingTotalMinor: 10_000n,
    currency: 'AUD',
    originalTransactions: [payment()],
    appliedAmendment: applied('ADDITIONAL_CHARGE'),
  };
  for (const originalTransactions of [null, {}, [null]]) {
    const result = deriveRentalBookingEffectiveSettlement({
      ...base,
      originalTransactions: originalTransactions as unknown as BookingSettlementTransaction[],
    });
    assert.equal(result.reconciled, false);
  }
  for (const postApplyRefunds of [{}, [undefined]]) {
    const result = deriveRentalBookingEffectiveSettlement({
      ...base,
      postApplyRefunds: postApplyRefunds as unknown as RentalBookingEffectiveRefundEvidence[],
    });
    assert.equal(result.reconciled, false);
  }
});
