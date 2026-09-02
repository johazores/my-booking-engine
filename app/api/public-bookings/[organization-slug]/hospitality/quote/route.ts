import { PublicBookingCapabilityConfigurationError } from '@/server/bookings/public-booking-capability.ts';
import { isSameOriginPublicBookingWrite } from '@/server/bookings/public-booking-http-policy.ts';
import { PublicHospitalityHoldAuthorizationError } from '@/server/bookings/public-hospitality-hold-service.ts';
import {
  HospitalityTransactionalPricingUnavailableError,
  quotePublicHospitalityHold,
} from '@/server/bookings/public-hospitality-quote-service.ts';
import { PublicHospitalityBookingUnavailableError } from '@/server/bookings/public-hospitality-search-service.ts';

function errorResponse(error: unknown) {
  if (error instanceof PublicHospitalityBookingUnavailableError || error instanceof PublicHospitalityHoldAuthorizationError) {
    return Response.json({ error: 'booking-unavailable' }, { status: 404, headers: { 'cache-control': 'no-store' } });
  }
  if (error instanceof HospitalityTransactionalPricingUnavailableError) {
    return Response.json(
      { error: 'pricing-unavailable', message: 'Current pricing is no longer available. Refresh your selection.' },
      { status: 409, headers: { 'cache-control': 'no-store' } },
    );
  }
  if (error instanceof PublicBookingCapabilityConfigurationError) {
    return Response.json({ error: 'booking-write-unavailable' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
  if (error instanceof SyntaxError) return Response.json({ error: 'invalid-json' }, { status: 400, headers: { 'cache-control': 'no-store' } });
  if (error instanceof Error && /must|required|invalid|cannot|between|at least|at most|unsupported/i.test(error.message)) {
    return Response.json({ error: 'validation', message: error.message }, { status: 400, headers: { 'cache-control': 'no-store' } });
  }
  return Response.json({ error: 'internal-error' }, { status: 500, headers: { 'cache-control': 'no-store' } });
}

type RouteContext = { params: Promise<{ 'organization-slug': string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    if (!isSameOriginPublicBookingWrite(request)) {
      return Response.json({ error: 'invalid-origin' }, { status: 403, headers: { 'cache-control': 'no-store' } });
    }

    const { 'organization-slug': organizationSlug } = await context.params;
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return Response.json({ error: 'invalid-request' }, { status: 400, headers: { 'cache-control': 'no-store' } });
    }

    const input = body as { capability?: unknown; addonSelections?: unknown };
    if (typeof input.capability !== 'string') {
      return Response.json({ error: 'invalid-request' }, { status: 400, headers: { 'cache-control': 'no-store' } });
    }
    if (input.addonSelections !== undefined && !Array.isArray(input.addonSelections)) {
      return Response.json({ error: 'invalid-request' }, { status: 400, headers: { 'cache-control': 'no-store' } });
    }

    const quote = await quotePublicHospitalityHold({
      organizationSlug,
      capability: input.capability,
      addonSelections: input.addonSelections as Parameters<typeof quotePublicHospitalityHold>[0]['addonSelections'],
    });
    return Response.json({ quote }, { status: 200, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
