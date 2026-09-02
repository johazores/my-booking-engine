import { AvailabilityHoldConflictError, AvailabilityHoldUnavailableError } from '@/server/availability/hospitality-availability-hold-core.ts';
import { AvailabilityUnavailableError } from '@/server/availability/hospitality-availability-service.ts';
import { PublicBookingAbuseLimitError } from '@/server/bookings/public-booking-abuse-control.ts';
import { PublicBookingCapabilityConfigurationError } from '@/server/bookings/public-booking-capability.ts';
import {
  createPublicHospitalityAvailabilityHold,
  PublicHospitalityHoldConflictError,
} from '@/server/bookings/public-hospitality-hold-service.ts';
import { PublicHospitalityBookingUnavailableError } from '@/server/bookings/public-hospitality-search-service.ts';

function isSameOriginPublicWrite(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function errorResponse(error: unknown) {
  if (error instanceof PublicBookingAbuseLimitError) {
    return Response.json(
      { error: 'temporarily-limited', message: 'Too many active reservation attempts. Try again shortly.' },
      { status: 429, headers: { 'retry-after': String(error.retryAfterSeconds) } },
    );
  }
  if (error instanceof PublicHospitalityBookingUnavailableError) {
    return Response.json({ error: 'booking-unavailable' }, { status: 404 });
  }
  if (error instanceof AvailabilityHoldConflictError || error instanceof PublicHospitalityHoldConflictError) {
    return Response.json({ error: 'conflict', message: error.message }, { status: 409 });
  }
  if (error instanceof AvailabilityHoldUnavailableError || error instanceof AvailabilityUnavailableError) {
    return Response.json({ error: 'unavailable', message: error.message }, { status: 409 });
  }
  if (error instanceof PublicBookingCapabilityConfigurationError) {
    return Response.json({ error: 'booking-write-unavailable' }, { status: 503 });
  }
  if (error instanceof SyntaxError) return Response.json({ error: 'invalid-json' }, { status: 400 });
  if (error instanceof Error && /must|required|invalid|cannot|between|at least|at most|unsupported/i.test(error.message)) {
    return Response.json({ error: 'validation', message: error.message }, { status: 400 });
  }
  return Response.json({ error: 'internal-error' }, { status: 500 });
}

type RouteContext = { params: Promise<{ 'organization-slug': string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    if (!isSameOriginPublicWrite(request)) {
      return Response.json({ error: 'invalid-origin' }, { status: 403 });
    }
    const { 'organization-slug': organizationSlug } = await context.params;
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return Response.json({ error: 'invalid-request' }, { status: 400 });
    }

    const input = body as { requestKey?: unknown; request?: unknown };
    if (typeof input.requestKey !== 'string' || !input.request || typeof input.request !== 'object' || Array.isArray(input.request)) {
      return Response.json({ error: 'invalid-request' }, { status: 400 });
    }

    const result = await createPublicHospitalityAvailabilityHold({
      organizationSlug,
      requestKey: input.requestKey,
      request: input.request as Parameters<typeof createPublicHospitalityAvailabilityHold>[0]['request'],
    });
    return Response.json(result, { status: 201, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
