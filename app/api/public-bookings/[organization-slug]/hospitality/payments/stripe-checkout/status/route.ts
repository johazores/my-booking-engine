import { PublicBookingCapabilityConfigurationError } from '@/server/bookings/public-booking-capability.ts';
import { isSameOriginPublicBookingWrite } from '@/server/bookings/public-booking-http-policy.ts';
import { PublicHospitalityBookingUnavailableError } from '@/server/bookings/public-hospitality-search-service.ts';
import { createRequestObservation } from '@/server/observability/request-observability.ts';
import { PaymentUnavailableError } from '@/server/payments/payment-service.ts';
import { getPublicStripePaymentStatus } from '@/server/payments/public-stripe-payment-status-service.ts';
import { PublicStripeCheckoutAuthorizationError } from '@/server/payments/public-stripe-checkout-service.ts';

const noStoreHeaders = { 'cache-control': 'no-store' };
type RouteContext = { params: Promise<{ 'organization-slug': string }> };

function errorResponse(error: unknown) {
  if (
    error instanceof PublicHospitalityBookingUnavailableError
    || error instanceof PublicStripeCheckoutAuthorizationError
    || error instanceof PaymentUnavailableError
  ) {
    return Response.json({ error: 'booking-unavailable' }, { status: 404, headers: noStoreHeaders });
  }
  if (error instanceof PublicBookingCapabilityConfigurationError) {
    return Response.json({ error: 'payment-unavailable' }, { status: 503, headers: noStoreHeaders });
  }
  return Response.json({ error: 'internal-error' }, { status: 500, headers: noStoreHeaders });
}

export async function POST(request: Request, context: RouteContext) {
  const observation = createRequestObservation(request, { operation: 'public-payment.stripe-checkout.status' });
  const finish = (response: Response) => observation.finish(response, { provider: 'stripe' });

  try {
    if (!isSameOriginPublicBookingWrite(request)) {
      return finish(Response.json({ error: 'invalid-origin' }, { status: 403, headers: noStoreHeaders }));
    }
    const { 'organization-slug': organizationSlug } = await context.params;
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return finish(Response.json({ error: 'invalid-request' }, { status: 400, headers: noStoreHeaders }));
    }
    const input = body as { bookingCapability?: unknown };
    if (typeof input.bookingCapability !== 'string') {
      return finish(Response.json({ error: 'invalid-request' }, { status: 400, headers: noStoreHeaders }));
    }

    const result = await getPublicStripePaymentStatus({
      organizationSlug,
      bookingCapability: input.bookingCapability,
    });
    return finish(Response.json(result, { status: 200, headers: noStoreHeaders }));
  } catch (error) {
    return finish(errorResponse(error));
  }
}
