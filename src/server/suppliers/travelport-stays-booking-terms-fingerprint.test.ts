import assert from 'node:assert/strict';
import test from 'node:test';

import type { HospitalitySupplierBookingTerms } from './hospitality-supplier-booking-terms.ts';
import { fingerprintTravelportStaysBookingTerms } from './travelport-stays-booking-terms-fingerprint.ts';

type FingerprintInput = Omit<HospitalitySupplierBookingTerms, 'termsFingerprint'>;

const base: FingerprintInput = Object.freeze({
  supplierPropertyReference: 'property-ref',
  supplierOfferReference: 'offer-ref',
  observedAt: '2026-09-07T00:00:00.000Z',
  price: Object.freeze({
    currency: 'USD',
    baseMinor: 12513n,
    taxMinor: 2252n,
    feeMinor: 0n,
    totalMinor: 14765n,
  }),
  paymentTiming: 'POSTPAY',
  guaranteeTypes: Object.freeze(['GUARANTEE_REQUIRED', 'DEPOSIT_REQUIRED'] as const),
  customerLoyaltyRequiredAtReservation: false,
  qualificationRequiredAtCheckIn: false,
  acceptedPaymentCardCodes: Object.freeze(['VI', 'AX']),
  cancellationRules: Object.freeze([Object.freeze({
    refundable: false,
    description: 'One night after the deadline.',
    deadline: Object.freeze({
      specificDate: null,
      startDate: '2026-10-10',
      endDate: null,
      timeLocal: '18:00:00',
    }),
    penalty: Object.freeze({
      kind: 'AMOUNT' as const,
      money: Object.freeze({ currency: 'USD', amountMinor: 14765n }),
    }),
  })]),
  deposits: Object.freeze([Object.freeze({
    remainder: true,
    dueDateLocal: '2026-10-01',
    money: Object.freeze({ currency: 'USD', amountMinor: 5000n }),
  })]),
  checkInTimeLocal: '15:00:00',
  checkOutTimeLocal: '11:00:00',
  textRules: Object.freeze([Object.freeze({
    title: 'Cancellation',
    language: 'EN',
    text: 'Cancel before the deadline to avoid the fee.',
  })]),
  completeForReservationReview: true,
  revalidationRequired: true,
});

test('Travelport Rules fingerprint ignores observation time and set ordering', () => {
  const expected = fingerprintTravelportStaysBookingTerms(base);
  const repeated = fingerprintTravelportStaysBookingTerms({
    ...base,
    observedAt: '2026-09-07T01:23:45.000Z',
    guaranteeTypes: Object.freeze([...base.guaranteeTypes].reverse()),
    acceptedPaymentCardCodes: Object.freeze([...base.acceptedPaymentCardCodes].reverse()),
  });

  assert.match(expected, /^[0-9a-f]{64}$/);
  assert.equal(repeated, expected);
});

test('Travelport Rules fingerprint changes for commercial authority changes', () => {
  const expected = fingerprintTravelportStaysBookingTerms(base);
  const changed = [
    { ...base, price: Object.freeze({ ...base.price, totalMinor: 14766n }) },
    { ...base, paymentTiming: 'PREPAY' as const },
    { ...base, guaranteeTypes: Object.freeze(['GUARANTEE_REQUIRED'] as const) },
    { ...base, acceptedPaymentCardCodes: Object.freeze(['VI']) },
    { ...base, customerLoyaltyRequiredAtReservation: true },
    { ...base, cancellationRules: Object.freeze([]) },
    { ...base, deposits: Object.freeze([]) },
    { ...base, checkInTimeLocal: '16:00:00' },
    { ...base, textRules: Object.freeze([]) },
    { ...base, completeForReservationReview: false },
  ];

  for (const candidate of changed) {
    assert.notEqual(fingerprintTravelportStaysBookingTerms(candidate), expected);
  }
});
