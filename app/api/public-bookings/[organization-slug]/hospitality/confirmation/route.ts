import { PublicBookingCapabilityConfigurationError } from '@/server/bookings/public-booking-capability.ts';
import { isSameOriginPublicBookingWrite } from '@/server/bookings/public-booking-http-policy.ts';
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
  if (error instanceof SyntaxError) {
    return Response.json({ error: 'invalid-json' }, { status: 400, headers: noStoreHeaders });
  }
  if (error instanceof Error && /must|required|invalid|cannot|between|at least|at most|unsupported/i.test(error.message)) {
    return Response.json({ error: 'validation', message: error.message }, { status: 400, headers: noStoreHeaders });
  }
  return Response.json({ error: 'internal-error' }, { status: 500, headers: noStoreHeaders });
}

export async function POST(request: Request, context: RouteContext) {
  try {
    if (!isSameOriginPublicBookingWrite(request)) {
      return Response.json({ error: 'invalid-origin' }, { status: 403, headers: noStoreHeaders });
    }

    const { 'organization-slug': organizationSlug } = await context.params;
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return Response.json({ error: 'invalid-request' }, { status: 400, headers: noStoreHeaders });
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
      return Response.json({ error: 'invalid-request' }, { status: 400, headers: noStoreHeaders });
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

    return Response.json(result, { status: 201, headers: noStoreHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}
