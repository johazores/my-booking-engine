import { readPublicOrganizationBrandingBySlug } from '../branding/branding-service.ts';
import { searchHospitalityOffersForOrganization } from './hospitality-search-service.ts';
import type { HospitalityOfferSearchInput } from './hospitality-search-domain.ts';

export class PublicHospitalityBookingUnavailableError extends Error {
  constructor(message = 'Public booking is unavailable.') {
    super(message);
    this.name = 'PublicHospitalityBookingUnavailableError';
  }
}

export async function readPublicHospitalityBookingPage(organizationSlug: string) {
  return readPublicOrganizationBrandingBySlug(organizationSlug);
}

export async function searchPublicHospitalityOffers(input: {
  organizationSlug: string;
  search: HospitalityOfferSearchInput;
  now?: Date;
}) {
  const branding = await readPublicOrganizationBrandingBySlug(input.organizationSlug);
  if (!branding) throw new PublicHospitalityBookingUnavailableError();

  const result = await searchHospitalityOffersForOrganization({
    organizationId: branding.id,
    search: input.search,
    now: input.now,
  });

  return { branding, ...result };
}
