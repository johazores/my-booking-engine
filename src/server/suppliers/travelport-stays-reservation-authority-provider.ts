import type { HospitalitySupplierBookingTermsProvider } from './hospitality-supplier-booking-terms.ts';
import type { HospitalitySupplierReservationAuthorityInput } from './hospitality-supplier-reservation-authority.ts';
import {
  materializeTravelportStaysReservationAuthorityConstructorAuthority,
} from './travelport-stays-constructor-authority.ts';
import {
  materializeTravelportStaysReservationAuthorityInput,
} from './travelport-stays-input-materialization.ts';
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
    const authority = materializeTravelportStaysReservationAuthorityConstructorAuthority(input);
    assertTravelportStaysReservationAuthorityCacheKey(authority.cacheKey);
    super({
      credentials: authority.credentials,
      cacheKey: authority.cacheKey,
      bookingTermsProvider: authority.bookingTermsProvider,
      fetchImpl: createTravelportStaysReservationAuthorityResponseFetch(authority.fetchImpl ?? fetch),
      timeoutMs: authority.timeoutMs,
      now: authority.now,
    });
  }

  override async verifyReservationAuthority(
    input: HospitalitySupplierReservationAuthorityInput,
  ): Promise<TravelportStaysReservationAuthorityResult> {
    const authority = materializeTravelportStaysReservationAuthorityInput(input);
    assertTravelportStaysPropertyReference(authority.supplierPropertyReference);
    assertTravelportStaysOfferReference(authority.supplierOfferReference);
    return super.verifyReservationAuthority(authority);
  }
}
