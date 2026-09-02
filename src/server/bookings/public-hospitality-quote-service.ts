import { readPublicOrganizationBrandingBySlug } from '../branding/branding-service.ts';
import { db } from '../database.ts';
import type { HospitalityAddonSelectionInput } from '../pricing/hospitality-addon-domain.ts';
import { HospitalityTransactionalPricingUnavailableError, quoteHospitalityPriceFromReader } from '../pricing/hospitality-transactional-pricing.ts';
import { PublicBookingCapabilityConfigurationError, verifyPublicBookingHoldCapability } from './public-booking-capability.ts';
import { PublicHospitalityHoldAuthorizationError } from './public-hospitality-hold-service.ts';
import { serializePublicHospitalityQuote } from './public-hospitality-quote-domain.ts';
import { PublicHospitalityBookingUnavailableError } from './public-hospitality-search-service.ts';

function publicBookingSecret() {
  const secret = process.env.SF_PUBLIC_BOOKING_SECRET?.trim();
  if (!secret) {
    throw new PublicBookingCapabilityConfigurationError('SF_PUBLIC_BOOKING_SECRET is required for public booking writes.');
  }
  return secret;
}

export async function quotePublicHospitalityHold(input: {
  organizationSlug: string;
  capability: string;
  addonSelections?: HospitalityAddonSelectionInput[];
  now?: Date;
}) {
  const branding = await readPublicOrganizationBrandingBySlug(input.organizationSlug);
  if (!branding) throw new PublicHospitalityBookingUnavailableError();

  const now = input.now ?? new Date();
  const capability = verifyPublicBookingHoldCapability({
    secret: publicBookingSecret(),
    token: input.capability,
    expectedOrganizationId: branding.id,
    now,
  });
  if (!capability) throw new PublicHospitalityHoldAuthorizationError();

  return db.$transaction(async (transaction) => {
    const ownership = await transaction.publicBookingHoldOwnership.findUnique({
      where: {
        organizationId_holdId: {
          organizationId: branding.id,
          holdId: capability.holdId,
        },
      },
    });
    if (!ownership || ownership.principalId !== capability.principalId) {
      throw new PublicHospitalityHoldAuthorizationError();
    }

    const [principal, hold] = await Promise.all([
      transaction.publicBookingPrincipal.findFirst({
        where: {
          id: capability.principalId,
          organizationId: branding.id,
          expiresAt: { gt: now },
        },
        select: { id: true },
      }),
      transaction.hospitalityAvailabilityHold.findFirst({
        where: {
          id: capability.holdId,
          organizationId: branding.id,
          status: 'ACTIVE',
          expiresAt: { gt: now },
        },
        select: {
          propertyId: true,
          roomTypeId: true,
          ratePlanId: true,
          arrivalDate: true,
          departureDate: true,
          quantity: true,
          adults: true,
          children: true,
          expiresAt: true,
        },
      }),
    ]);
    if (!principal || !hold) throw new PublicHospitalityHoldAuthorizationError();

    const quote = await quoteHospitalityPriceFromReader({
      reader: transaction,
      organizationId: branding.id,
      request: {
        propertyId: hold.propertyId,
        roomTypeId: hold.roomTypeId,
        ratePlanId: hold.ratePlanId,
        arrivalDate: hold.arrivalDate,
        departureDate: hold.departureDate,
        quantity: hold.quantity,
        adults: hold.adults,
        children: hold.children,
      },
      addonSelections: input.addonSelections,
    });

    return serializePublicHospitalityQuote(quote, hold.expiresAt);
  }, { isolationLevel: 'Serializable' });
}

export { HospitalityTransactionalPricingUnavailableError };
