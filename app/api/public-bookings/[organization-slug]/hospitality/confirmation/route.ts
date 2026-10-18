import { BookingDomainValidationError } from '@/server/bookings/booking-domain.ts';
import { PublicBookingCapabilityConfigurationError } from '@/server/bookings/public-booking-capability.ts';
import { isSameOriginPublicBookingWrite, readPublicBookingJsonObject } from '@/server/bookings/public-booking-http-policy.ts';
import { PublicBookingRequestValidationError } from '@/server/bookings/public-booking-request-domain.ts';
import { CustomerValidationError } from '@/server/customers/customer-domain.ts';
import {
  confirmPublicHospitalityBookingFromHold,
  HospitalityBookingConflictError,
  HospitalityBookingPriceChangedError,
  HospitalityBookingUnavailableError,
  PublicHospitalityConfirmationConflictError,
  PublicHospitalityCustomerUnavailableError,
} from '@/server/bookings/public-hospitality-confirmation-service.ts';
import { PublicHospitalityHoldAuthorizationError } from '@/server/bookings/public-hospitality-hold-service.ts';
import { PublicHospitalityBookingUnavailableError } from '@/server/bookings/public-hospitality-search-service.ts';
import { PricingValidationError } from '@/server/pricing/money.ts';
import { createRequestObservation } from '@/server/observability/request-observability.ts';

const noStoreHeaders = { 'cache-control': 'no-store' };
type RouteContext = { params: Promise<{ 'organization-slug': string }> };

function errorResponse(error: unknown) {
  if (error instanceof PublicHospitalityBookingUnavailableError || error instanceof PublicHospitalityHoldAuthorizationError) {
    return Response.json({ error: 'booking-unavailable' }, { status: 404, headers: noStoreHeaders });
  }
  if (error instanceof HospitalityBookingPriceChangedError) {
    return Response.json(
      { error: 'price-changed', message: 'The stay price changed before confirmation. Review current availability and pricing again.' },
      { status: 409, headers: noStoreHeaders },
    );
  }
  if (
    error instanceof HospitalityBookingConflictError
    || error instanceof PublicHospitalityConfirmationConflictError
    || error instanceof PublicHospitalityCustomerUnavailableError
  ) {
    return Response.json({ error: 'conflict', message: error.message }, { status: 409, headers: noStoreHeaders });
  }
  if (error instanceof HospitalityBookingUnavailableError) {
    return Response.json(
      { error: 'unavailable', message: 'This held stay is no longer available. Search again.' },
      { status: 409, headers: noStoreHeaders },
    );
  }
  if (error instanceof PublicBookingCapabilityConfigurationError) {
    return Response.json({ error: 'booking-write-unavailable' }, { status: 503, headers: noStoreHeaders });
  }
  if (
    error instanceof BookingDomainValidationError
    || error instanceof CustomerValidationError
    || error instanceof PricingValidationError
    || error instanceof PublicBookingRequestValidationError
  ) {
    return Response.json({ error: 'validation', message: error.message }, { status: 400, headers: noStoreHeaders });
  }
  return Response.json({ error: 'internal-error' }, { status: 500, headers: noStoreHeaders });
}

export async function POST(request: Request, context: RouteContext) {
  const observation = createRequestObservation(request, { operation: 'public-booking.hospitality-confirmation.create' });
  const finish = (response: Response) => observation.finish(response);

  try {
    if (!isSameOriginPublicBookingWrite(request)) {
      return finish(Response.json({ error: 'invalid-origin' }, { status: 403, headers: noStoreHeaders }));
    }

    const { 'organization-slug': organizationSlug } = await context.params;
    const body = await readPublicBookingJsonObject(request);
    if (!body) {
      return finish(Response.json({ error: 'invalid-request' }, { status: 400, headers: noStoreHeaders }));
    }

    const input = body as {
      capability?: unknown;
      requestKey?: unknown;
      expectedPricingFingerprint?: unknown;
      customer?: unknown;
      guests?: unknown;
      addonSelections?: unknown;
    };
    if (
      typeof input.capability !== 'string'
      || typeof input.requestKey !== 'string'
      || typeof input.expectedPricingFingerprint !== 'string'
      || !input.customer
      || typeof input.customer !== 'object'
      || Array.isArray(input.customer)
      || !Array.isArray(input.guests)
      || (input.addonSelections !== undefined && !Array.isArray(input.addonSelections))
    ) {
      return finish(Response.json({ error: 'invalid-request' }, { status: 400, headers: noStoreHeaders }));
    }

    const customer = input.customer as Record<string, unknown>;
    if (
      typeof customer.firstName !== 'string'
      || typeof customer.lastName !== 'string'
      || typeof customer.email !== 'string'
      || (customer.phone !== undefined && customer.phone !== null && typeof customer.phone !== 'string')
      || !input.guests.every((guest) =>
        guest !== null
        && typeof guest === 'object'
        && !Array.isArray(guest)
        && typeof guest.firstName === 'string'
        && typeof guest.lastName === 'string'
        && (guest.email === undefined || guest.email === null || typeof guest.email === 'string')
      )
      || (input.addonSelections !== undefined && !input.addonSelections.every((selection) =>
        selection !== null
        && typeof selection === 'object'
        && !Array.isArray(selection)
        && typeof selection.addonId === 'string'
        && typeof selection.quantity === 'number'
      ))
    ) {
      return finish(Response.json({ error: 'invalid-request' }, { status: 400, headers: noStoreHeaders }));
    }

    const result = await confirmPublicHospitalityBookingFromHold({
      organizationSlug,
      capability: input.capability,
      requestKey: input.requestKey,
      expectedPricingFingerprint: input.expectedPricingFingerprint,
      customer: input.customer as Parameters<typeof confirmPublicHospitalityBookingFromHold>[0]['customer'],
      guests: input.guests as Parameters<typeof confirmPublicHospitalityBookingFromHold>[0]['guests'],
      addonSelections: input.addonSelections as Parameters<typeof confirmPublicHospitalityBookingFromHold>[0]['addonSelections'],
    });

    return finish(Response.json(result, { status: 201, headers: noStoreHeaders }));
  } catch (error) {
    return finish(errorResponse(error));
  }
}
