import type {
  HospitalitySupplierMoney,
  HospitalitySupplierOffer,
  HospitalitySupplierOfferRevalidationInput,
  HospitalitySupplierPaymentTiming,
} from './hospitality-supplier-provider.ts';

export type HospitalitySupplierRuleGuaranteeType =
  | 'PREPAY_REQUIRED'
  | 'DEPOSIT_REQUIRED'
  | 'GUARANTEES_NOT_REQUIRED'
  | 'PROFILE'
  | 'DEPOSIT_NOT_REQUIRED'
  | 'NO_GUARANTEES_ACCEPTED'
  | 'GUARANTEE_REQUIRED'
  | 'CREDIT_DEBIT_VOUCHER'
  | 'PREPAY_NOT_REQUIRED'
  | 'GUARANTEES_ACCEPTED'
  | 'NO_DEPOSITS_ACCEPTED'
  | 'UNKNOWN';

export type HospitalitySupplierRuleText = Readonly<{
  title: string | null;
  language: string | null;
  text: string;
}>;

export type HospitalitySupplierCancellationRule = Readonly<{
  refundable: boolean | null;
  description: string | null;
  deadline: Readonly<{
    specificDate: string | null;
    startDate: string | null;
    endDate: string | null;
    timeLocal: string | null;
  }> | null;
  penalty:
    | Readonly<{ kind: 'AMOUNT'; money: HospitalitySupplierMoney }>
    | Readonly<{ kind: 'PERCENT'; percent: string }>
    | Readonly<{ kind: 'NIGHTS'; nights: string; subjectToTax: 'YES' | 'NO' | 'UNKNOWN' }>
    | null;
}>;

export type HospitalitySupplierDepositRule = Readonly<{
  remainder: boolean | null;
  dueDateLocal: string | null;
  money: HospitalitySupplierMoney | null;
}>;

export type HospitalitySupplierBookingTerms = Readonly<{
  supplierPropertyReference: string;
  supplierOfferReference: string;
  observedAt: string;
  price: Readonly<{
    currency: string;
    baseMinor: bigint | null;
    taxMinor: bigint | null;
    feeMinor: bigint | null;
    totalMinor: bigint;
  }>;
  paymentTiming: HospitalitySupplierPaymentTiming;
  guaranteeTypes: readonly HospitalitySupplierRuleGuaranteeType[];
  customerLoyaltyRequiredAtReservation: boolean | null;
  qualificationRequiredAtCheckIn: boolean | null;
  acceptedPaymentCardCodes: readonly string[];
  cancellationRules: readonly HospitalitySupplierCancellationRule[];
  deposits: readonly HospitalitySupplierDepositRule[];
  checkInTimeLocal: string | null;
  checkOutTimeLocal: string | null;
  textRules: readonly HospitalitySupplierRuleText[];
  termsFingerprint: string;
  completeForReservationReview: boolean;
  revalidationRequired: true;
}>;

export type HospitalitySupplierBookingTermsResult = Readonly<{
  status: 'READY' | 'PRICE_CHANGED' | 'OFFER_CHANGED' | 'UNAVAILABLE';
  offer: HospitalitySupplierOffer | null;
  bookingTerms: HospitalitySupplierBookingTerms | null;
  observedAt: string;
}>;

export interface HospitalitySupplierBookingTermsProvider {
  retrieveBookingTerms(input: HospitalitySupplierOfferRevalidationInput): Promise<HospitalitySupplierBookingTermsResult>;
}
