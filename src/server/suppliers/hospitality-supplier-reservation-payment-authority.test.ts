import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveHospitalitySupplierReservationPaymentAuthority } from './hospitality-supplier-reservation-payment-authority.ts';

function bookingTerms(input: {
  guaranteeTypes: readonly string[];
  deposits?: readonly { money: { currency: string; amountMinor: bigint } | null }[];
  acceptedPaymentCardCodes?: readonly string[];
}) {
  return {
    guaranteeTypes: input.guaranteeTypes,
    deposits: input.deposits ?? [],
    acceptedPaymentCardCodes: input.acceptedPaymentCardCodes ?? ['VI'],
  } as never;
}

test('derives exact prepay and guarantee authority from fresh normalized terms', () => {
  assert.deepEqual(deriveHospitalitySupplierReservationPaymentAuthority({
    bookingTerms: bookingTerms({ guaranteeTypes: ['PREPAY_REQUIRED'], acceptedPaymentCardCodes: ['VI', 'AX'] }),
    currency: 'USD',
    expectedTotalMinor: 125_500n,
  }), {
    kind: 'PREPAY',
    collectionTiming: 'AT_BOOKING',
    currency: 'USD',
    amountMinor: 125_500n,
    acceptedPaymentCardCodes: ['VI', 'AX'],
  });

  assert.deepEqual(deriveHospitalitySupplierReservationPaymentAuthority({
    bookingTerms: bookingTerms({ guaranteeTypes: ['GUARANTEE_REQUIRED'] }),
    currency: 'USD',
    expectedTotalMinor: 125_500n,
  }), {
    kind: 'GUARANTEE',
    collectionTiming: 'AT_PROPERTY',
    currency: 'USD',
    amountMinor: 125_500n,
    acceptedPaymentCardCodes: ['VI'],
  });
});

test('derives deposit authority only from one exact same-currency deposit amount', () => {
  assert.deepEqual(deriveHospitalitySupplierReservationPaymentAuthority({
    bookingTerms: bookingTerms({
      guaranteeTypes: ['DEPOSIT_REQUIRED'],
      deposits: [{ money: { currency: 'USD', amountMinor: 50_000n } }],
    }),
    currency: 'USD',
    expectedTotalMinor: 125_500n,
  }), {
    kind: 'DEPOSIT',
    collectionTiming: 'AT_BOOKING',
    currency: 'USD',
    amountMinor: 50_000n,
    acceptedPaymentCardCodes: ['VI'],
  });

  for (const deposits of [
    [],
    [{ money: null }],
    [{ money: { currency: 'EUR', amountMinor: 50_000n } }],
    [{ money: { currency: 'USD', amountMinor: 0n } }],
    [{ money: { currency: 'USD', amountMinor: 125_501n } }],
    [{ money: { currency: 'USD', amountMinor: 50_000n } }, { money: { currency: 'USD', amountMinor: 25_000n } }],
  ] as const) {
    assert.equal(deriveHospitalitySupplierReservationPaymentAuthority({
      bookingTerms: bookingTerms({ guaranteeTypes: ['DEPOSIT_REQUIRED'], deposits }),
      currency: 'USD',
      expectedTotalMinor: 125_500n,
    }), null);
  }
});

test('fails closed for missing, conflicting, or unsafe create-payment evidence', () => {
  for (const terms of [
    bookingTerms({ guaranteeTypes: [] }),
    bookingTerms({ guaranteeTypes: ['GUARANTEES_NOT_REQUIRED'] }),
    bookingTerms({ guaranteeTypes: ['PREPAY_REQUIRED', 'GUARANTEE_REQUIRED'] }),
    bookingTerms({ guaranteeTypes: ['GUARANTEE_REQUIRED'], acceptedPaymentCardCodes: ['VI', 'VI'] }),
    bookingTerms({ guaranteeTypes: ['GUARANTEE_REQUIRED'], acceptedPaymentCardCodes: ['bad\ncode'] }),
  ]) {
    assert.equal(deriveHospitalitySupplierReservationPaymentAuthority({
      bookingTerms: terms,
      currency: 'USD',
      expectedTotalMinor: 125_500n,
    }), null);
  }
});
