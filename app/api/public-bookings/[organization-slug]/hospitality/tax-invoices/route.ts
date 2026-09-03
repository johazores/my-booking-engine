import { PublicBookingCapabilityConfigurationError } from '@/server/bookings/public-booking-capability.ts';
import { isSameOriginPublicBookingWrite } from '@/server/bookings/public-booking-http-policy.ts';
import { PublicHospitalityBookingUnavailableError } from '@/server/bookings/public-hospitality-search-service.ts';
import {
  listPublicBookingIssuedTaxInvoices,
  PublicIssuedTaxInvoiceAuthorizationError,
  PublicIssuedTaxInvoicePersistenceError,
} from '@/server/payments/public-issued-tax-invoice-service.ts';

const noStoreHeaders = { 'cache-control': 'no-store' };
type RouteContext = { params: Promise<{ 'organization-slug': string }> };

function errorResponse(error: unknown) {
  if (error instanceof PublicHospitalityBookingUnavailableError || error instanceof PublicIssuedTaxInvoiceAuthorizationError) {
    return Response.json({ error: 'invoice-unavailable' }, { status: 404, headers: noStoreHeaders });
  }
  if (error instanceof PublicIssuedTaxInvoicePersistenceError) {
    return Response.json({ error: 'invoice-evidence-invalid' }, { status: 500, headers: noStoreHeaders });
  }
  if (error instanceof PublicBookingCapabilityConfigurationError) {
    return Response.json({ error: 'invoice-unavailable' }, { status: 503, headers: noStoreHeaders });
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
    const input = body as { bookingCapability?: unknown };
    if (typeof input.bookingCapability !== 'string') {
      return Response.json({ error: 'invalid-request' }, { status: 400, headers: noStoreHeaders });
    }

    const invoices = await listPublicBookingIssuedTaxInvoices({
      organizationSlug,
      bookingCapability: input.bookingCapability,
    });
    return Response.json(invoices, { status: 200, headers: noStoreHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}
