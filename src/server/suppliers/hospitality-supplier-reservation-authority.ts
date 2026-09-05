import type {
  HospitalitySupplierOffer,
  HospitalitySupplierOfferRevalidationInput,
} from './hospitality-supplier-provider.ts';
import type {
  HospitalitySupplierBookingTerms,
} from './hospitality-supplier-booking-terms.ts';

export type HospitalitySupplierReservationAuthorityInput = HospitalitySupplierOfferRevalidationInput & Readonly<{
  expectedTermsFingerprint: string;
}>;

export type HospitalitySupplierReservationAuthorityResult = Readonly<{
  status:
    | 'READY'
    | 'PRICE_CHANGED'
    | 'OFFER_CHANGED'
    | 'TERMS_CHANGED'
    | 'TERMS_INCOMPLETE'
    | 'UNAVAILABLE';
  offer: HospitalitySupplierOffer | null;
  bookingTerms: HospitalitySupplierBookingTerms | null;
  authorityFingerprint: string | null;
  observedAt: string;
  revalidationRequired: true;
}>;

export interface HospitalitySupplierReservationAuthorityProvider {
  verifyReservationAuthority(
    input: HospitalitySupplierReservationAuthorityInput,
  ): Promise<HospitalitySupplierReservationAuthorityResult>;
}
