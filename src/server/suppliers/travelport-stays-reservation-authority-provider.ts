import type { HospitalitySupplierBookingTermsProvider } from './hospitality-supplier-booking-terms.ts';
import type { HospitalitySupplierReservationAuthorityInput } from './hospitality-supplier-reservation-authority.ts';
import {
  assertTravelportStaysOfferReference,
  assertTravelportStaysPropertyReference,
  type TravelportStaysCredentials,
} from './travelport-stays-provider.ts';
import {
  TravelportStaysReservationAuthorityProvider as CoreTravelportStaysReservationAuthorityProvider,
  type TravelportStaysReservationAuthorityResult,
} from './travelport-stays-reservation-authority-provider-core.ts';
import {
  assertTravelportStaysReservationAuthorityCacheKey,
  createTravelportStaysReservationAuthorityResponseFetch,
} from './travelport-stays-reservation-authority-boundary.ts';

export type { TravelportStaysReservationAuthorityResult } from './travelport-stays-reservation-authority-provider-core.ts';

export class TravelportStaysReservationAuthorityProvider extends CoreTravelportStaysReservationAuthorityProvider {
  constructor(input: {
    credentials: TravelportStaysCredentials;
    cacheKey: string;
    bookingTermsProvider: HospitalitySupplierBookingTermsProvider;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    now?: () => Date;
  }) {
    assertTravelportStaysReservationAuthorityCacheKey(input.cacheKey);
    super({
      ...input,
      fetchImpl: createTravelportStaysReservationAuthorityResponseFetch(input.fetchImpl ?? fetch),
    });
  }

  override async verifyReservationAuthority(
    input: HospitalitySupplierReservationAuthorityInput,
  ): Promise<TravelportStaysReservationAuthorityResult> {
    assertTravelportStaysPropertyReference(input.supplierPropertyReference);
    assertTravelportStaysOfferReference(input.supplierOfferReference);
    return super.verifyReservationAuthority(input);
  }
}
