import type {
  HospitalitySupplierOfferRevalidationInput,
} from './hospitality-supplier-provider.ts';
import type {
  HospitalitySupplierBookingTermsResult,
} from './hospitality-supplier-booking-terms.ts';
import { TravelportStaysBookingTermsProvider as CoreTravelportStaysBookingTermsProvider } from './travelport-stays-booking-terms-provider-core.ts';
import {
  materializeTravelportStaysOfferRevalidationInput,
} from './travelport-stays-input-materialization.ts';
import {
  assertTravelportStaysOfferReference,
  assertTravelportStaysPropertyReference,
  createTravelportStaysReferenceAuthorityFetch,
  type TravelportStaysCredentials,
} from './travelport-stays-provider.ts';
import type { HospitalitySupplierPricingProvider } from './hospitality-supplier-provider.ts';

export class TravelportStaysBookingTermsProvider extends CoreTravelportStaysBookingTermsProvider {
  constructor(input: {
    credentials: TravelportStaysCredentials;
    cacheKey: string;
    pricingProvider: HospitalitySupplierPricingProvider;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    now?: () => Date;
  }) {
    super({
      ...input,
      fetchImpl: createTravelportStaysReferenceAuthorityFetch(input.fetchImpl ?? fetch),
    });
  }

  override async retrieveBookingTerms(
    input: HospitalitySupplierOfferRevalidationInput,
  ): Promise<HospitalitySupplierBookingTermsResult> {
    const authority = materializeTravelportStaysOfferRevalidationInput(input);
    assertTravelportStaysPropertyReference(authority.supplierPropertyReference);
    assertTravelportStaysOfferReference(authority.supplierOfferReference);
    return super.retrieveBookingTerms(authority);
  }
}
