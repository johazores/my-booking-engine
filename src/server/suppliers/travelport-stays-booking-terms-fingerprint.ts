import { createHash } from 'node:crypto';

import type { HospitalitySupplierBookingTerms } from './hospitality-supplier-booking-terms.ts';

export function fingerprintTravelportStaysBookingTerms(
  value: Omit<HospitalitySupplierBookingTerms, 'termsFingerprint'>,
) {
  const payload = {
    supplierPropertyReference: value.supplierPropertyReference,
    supplierOfferReference: value.supplierOfferReference,
    price: {
      currency: value.price.currency,
      baseMinor: value.price.baseMinor?.toString() ?? null,
      taxMinor: value.price.taxMinor?.toString() ?? null,
      feeMinor: value.price.feeMinor?.toString() ?? null,
      totalMinor: value.price.totalMinor.toString(),
    },
    paymentTiming: value.paymentTiming,
    guaranteeTypes: [...value.guaranteeTypes].sort(),
    customerLoyaltyRequiredAtReservation: value.customerLoyaltyRequiredAtReservation,
    qualificationRequiredAtCheckIn: value.qualificationRequiredAtCheckIn,
    acceptedPaymentCardCodes: [...value.acceptedPaymentCardCodes].sort(),
    cancellationRules: value.cancellationRules.map((rule) => ({
      ...rule,
      penalty: rule.penalty?.kind === 'AMOUNT'
        ? {
            kind: 'AMOUNT' as const,
            money: {
              currency: rule.penalty.money.currency,
              amountMinor: rule.penalty.money.amountMinor.toString(),
            },
          }
        : rule.penalty,
    })),
    deposits: value.deposits.map((deposit) => ({
      ...deposit,
      money: deposit.money
        ? {
            currency: deposit.money.currency,
            amountMinor: deposit.money.amountMinor.toString(),
          }
        : null,
    })),
    checkInTimeLocal: value.checkInTimeLocal,
    checkOutTimeLocal: value.checkOutTimeLocal,
    textRules: value.textRules,
    completeForReservationReview: value.completeForReservationReview,
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
