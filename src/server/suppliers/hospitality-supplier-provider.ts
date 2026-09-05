export const hospitalitySupplierFailureCodes = [
  'AUTHENTICATION_FAILED',
  'RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
  'TIMEOUT',
  'INVALID_REQUEST',
  'INVALID_RESPONSE',
] as const;

export type HospitalitySupplierFailureCode = (typeof hospitalitySupplierFailureCodes)[number];

export class HospitalitySupplierProviderError extends Error {
  readonly code: HospitalitySupplierFailureCode;
  readonly retryable: boolean;

  constructor(code: HospitalitySupplierFailureCode, message = 'The hospitality supplier request could not be completed.') {
    super(message);
    this.name = 'HospitalitySupplierProviderError';
    this.code = code;
    this.retryable = code === 'RATE_LIMITED' || code === 'PROVIDER_UNAVAILABLE' || code === 'TIMEOUT';
  }
}

export type HospitalitySupplierSearchInput = Readonly<{
  cityIataCode: string;
  checkInDateLocal: string;
  checkOutDateLocal: string;
  rooms: number;
  adults: number;
  childAges?: readonly number[];
  radiusKm?: number;
}>;

export type HospitalitySupplierSearchPageInput = Readonly<{
  pageToken: string;
  pageNumber: number;
}>;

export type HospitalitySupplierProperty = Readonly<{
  supplierPropertyReference: string;
  name: string;
  propertyType: string | null;
  available: boolean;
}>;

export type HospitalitySupplierSearchResult = Readonly<{
  properties: readonly HospitalitySupplierProperty[];
  page: number;
  pageSize: number;
  totalPages: number;
  totalItems: number;
  nextPageToken: string | null;
}>;

export type HospitalitySupplierMoney = Readonly<{
  currency: string;
  amountMinor: bigint;
}>;

export type HospitalitySupplierPaymentTiming = 'PREPAY' | 'POSTPAY' | 'UNKNOWN';
export type HospitalitySupplierGuaranteeType =
  | 'GUARANTEE_REQUIRED'
  | 'NO_GUARANTEES_ACCEPTED'
  | 'DEPOSIT_REQUIRED'
  | 'PREPAY_REQUIRED'
  | 'UNKNOWN';
export type HospitalitySupplierPriceChangeProbability = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

export type HospitalitySupplierCancellationPenalty = Readonly<{
  deadlineLocal: string | null;
  deadlineEstimated: boolean | null;
  description: string | null;
  money: HospitalitySupplierMoney | null;
  moneyEstimated: boolean | null;
}>;

export type HospitalitySupplierOffer = Readonly<{
  supplierPropertyReference: string;
  supplierOfferReference: string;
  roomDescription: string | null;
  rateDescription: string | null;
  availableQuantity: number;
  price: Readonly<{
    currency: string;
    baseMinor: bigint;
    taxMinor: bigint;
    totalMinor: bigint;
    includedFeeMinor: bigint | null;
    feesDueAtPropertyMinor: bigint | null;
    taxesIncludedInBase: boolean | null;
    resortFeeIncluded: boolean | null;
    predictedPriceChangeDuringStay: boolean | null;
  }>;
  terms: Readonly<{
    refundable: boolean | null;
    paymentTiming: HospitalitySupplierPaymentTiming;
    guaranteeType: HospitalitySupplierGuaranteeType;
    paymentTypeEstimated: boolean | null;
    customerLoyaltyRequiredAtReservation: boolean | null;
    qualificationRequiredAtCheckIn: boolean | null;
    cancellationNote: string | null;
    cancellationPenalties: readonly HospitalitySupplierCancellationPenalty[];
  }>;
  inclusions: Readonly<{
    wifi: boolean | null;
    breakfast: boolean | null;
    lunch: boolean | null;
    dinner: boolean | null;
    freeParking: boolean | null;
    valetParking: boolean | null;
  }>;
  priceChangeProbability: HospitalitySupplierPriceChangeProbability;
  offerFingerprint: string;
  revalidationRequired: true;
  rulesRequiredBeforeReservation: true;
}>;

export type HospitalitySupplierOfferSearchInput = Readonly<{
  supplierPropertyReference: string;
  checkInDateLocal: string;
  checkOutDateLocal: string;
  rooms: number;
  adults: number;
  childAges?: readonly number[];
  currency: string;
}>;

export type HospitalitySupplierOfferSearchResult = Readonly<{
  supplierPropertyReference: string;
  property: HospitalitySupplierProperty | null;
  offers: readonly HospitalitySupplierOffer[];
  observedAt: string;
  providerCacheMode: 'NO_CACHE';
  validUntil: null;
  revalidationRequired: true;
  rulesRequiredBeforeReservation: true;
}>;

export type HospitalitySupplierOfferRevalidationInput = HospitalitySupplierOfferSearchInput & Readonly<{
  supplierOfferReference: string;
  expectedTotalMinor: bigint;
  expectedOfferFingerprint: string;
}>;

export type HospitalitySupplierOfferRevalidationResult = Readonly<{
  status: 'UNCHANGED' | 'PRICE_CHANGED' | 'OFFER_CHANGED' | 'UNAVAILABLE';
  offer: HospitalitySupplierOffer | null;
  observedAt: string;
  validUntil: null;
}>;

export interface HospitalitySupplierProvider {
  readonly code: string;
  searchProperties(input: HospitalitySupplierSearchInput): Promise<HospitalitySupplierSearchResult>;
  searchPropertiesPage(input: HospitalitySupplierSearchPageInput): Promise<HospitalitySupplierSearchResult>;
}

export interface HospitalitySupplierPricingProvider extends HospitalitySupplierProvider {
  searchPropertyOffers(input: HospitalitySupplierOfferSearchInput): Promise<HospitalitySupplierOfferSearchResult>;
  revalidatePropertyOffer(input: HospitalitySupplierOfferRevalidationInput): Promise<HospitalitySupplierOfferRevalidationResult>;
}
