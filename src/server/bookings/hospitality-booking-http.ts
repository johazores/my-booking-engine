import { isSameOriginAuthRequest, readAuthSession } from '../auth/auth-http.ts';
import { OrganizationPermissionDeniedError } from '../authorization/authorization-service.ts';
import { AvailabilityHoldConflictError, AvailabilityHoldUnavailableError } from '../availability/hospitality-availability-hold-service.ts';
import { AvailabilityUnavailableError } from '../availability/hospitality-availability-service.ts';
import { HospitalityPricingUnavailableError } from '../pricing/hospitality-pricing-service.ts';
import { readActiveOrganizationContext } from '../tenancy/tenant-context.ts';
import {
  HospitalityBookingConflictError,
  HospitalityBookingPriceChangedError,
  HospitalityBookingUnavailableError,
} from './hospitality-booking-service.ts';

export class BookingApiRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BookingApiRequestError';
  }
}

export async function requireHospitalityBookingApiContext(request: Request, options?: { write?: boolean }) {
  if (options?.write && !isSameOriginAuthRequest(request)) {
    throw new BookingApiRequestError('Request origin is not allowed.');
  }

  const session = await readAuthSession();
  if (!session) return { response: Response.json({ error: 'authentication-required' }, { status: 401 }) } as const;

  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) return { response: Response.json({ error: 'organization-required' }, { status: 409 }) } as const;

  return {
    response: null,
    organizationId: activeContext.organization.id,
    actorUserId: session.user.id,
  } as const;
}

export function hospitalityBookingJson(value: unknown, status = 200) {
  return new Response(JSON.stringify(value, (_key, item) => {
    if (typeof item === 'bigint') return item.toString();
    if (item instanceof Date) return item.toISOString();
    return item;
  }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export function hospitalityBookingApiError(error: unknown) {
  if (error instanceof BookingApiRequestError) return Response.json({ error: 'invalid-request', message: error.message }, { status: 403 });
  if (error instanceof OrganizationPermissionDeniedError) return Response.json({ error: 'forbidden' }, { status: 403 });
  if (error instanceof HospitalityBookingPriceChangedError) return Response.json({ error: 'price-changed', message: error.message }, { status: 409 });
  if (error instanceof HospitalityBookingConflictError || error instanceof AvailabilityHoldConflictError) {
    return Response.json({ error: 'conflict', message: error.message }, { status: 409 });
  }
  if (error instanceof HospitalityBookingUnavailableError || error instanceof AvailabilityHoldUnavailableError || error instanceof AvailabilityUnavailableError || error instanceof HospitalityPricingUnavailableError) {
    return Response.json({ error: 'unavailable', message: error.message }, { status: 409 });
  }
  if (error instanceof SyntaxError) return Response.json({ error: 'invalid-json' }, { status: 400 });
  if (error instanceof Error && /must|required|invalid|cannot|between|at least|at most|unsupported/i.test(error.message)) {
    return Response.json({ error: 'validation', message: error.message }, { status: 400 });
  }
  return Response.json({ error: 'internal-error' }, { status: 500 });
}
