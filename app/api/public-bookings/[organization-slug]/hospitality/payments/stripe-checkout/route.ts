import { PublicBookingCapabilityConfigurationError } from '@/server/bookings/public-booking-capability.ts';
import { isSameOriginPublicBookingWrite } from '@/server/bookings/public-booking-http-policy.ts';
import { PublicHospitalityBookingUnavailableError } from '@/server/bookings/public-hospitality-search-service.ts';
import { createRequestObservation } from '@/server/observability/request-observability.ts';
import { PaymentConflictError, PaymentUnavailableError } from '@/server/payments/payment-service.ts';
import { PaymentProviderError } from '@/server/payments/payment-provider.ts';
import {
  createPublicStripeCheckoutSession,
  PublicStripeCheckoutAuthorizationError,
  PublicStripeCheckoutUnavailableError,
} from '@/server/payments/public-stripe-checkout-service.ts';

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
  if (error instanceof PaymentConflictError) {
    return Response.json({ error: 'conflict', message: error.message }, { status: 409, headers: noStoreHeaders });
  }
  if (error instanceof PublicStripeCheckoutUnavailableError || error instanceof PublicBookingCapabilityConfigurationError) {
    return Response.json({ error: 'payment-unavailable' }, { status: 503, headers: noStoreHeaders });
  }
  if (error instanceof PaymentProviderError) {
    if (error.retryable) {
      return Response.json({ error: 'payment-temporarily-unavailable' }, { status: 503, headers: noStoreHeaders });
    }
    return Response.json({ error: 'payment-rejected', code: error.code }, { status: 409, headers: noStoreHeaders });
  }
  if (error instanceof SyntaxError) return Response.json({ error: 'invalid-json' }, { status: 400, headers: noStoreHeaders });
  if (error instanceof Error && /must|required|invalid|cannot|between|at least|at most|unsupported/i.test(error.message)) {
    return Response.json({ error: 'validation', message: error.message }, { status: 400, headers: noStoreHeaders });
  }
  return Response.json({ error: 'internal-error' }, { status: 500, headers: noStoreHeaders });
}

export async function POST(request: Request, context: RouteContext) {
  const observation = createRequestObservation(request, { operation: 'public-payment.stripe-checkout.create' });
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
    const input = body as { bookingCapability?: unknown; requestKey?: unknown };
    if (typeof input.bookingCapability !== 'string' || typeof input.requestKey !== 'string') {
      return finish(Response.json({ error: 'invalid-request' }, { status: 400, headers: noStoreHeaders }));
    }

    const returnUrl = new URL(`/book/${encodeURIComponent(organizationSlug)}`, request.url);
    const successUrl = new URL(returnUrl);
    successUrl.searchParams.set('payment', 'processing');
    const cancelUrl = new URL(returnUrl);
    cancelUrl.searchParams.set('payment', 'cancelled');

    const result = await createPublicStripeCheckoutSession({
      organizationSlug,
      bookingCapability: input.bookingCapability,
      requestKey: input.requestKey,
      successUrl: successUrl.toString(),
      cancelUrl: cancelUrl.toString(),
    });

    return finish(Response.json(result, {
      status: result.state === 'CHECKOUT_REQUIRED' ? 201 : 200,
      headers: noStoreHeaders,
    }));
  } catch (error) {
    return finish(errorResponse(error));
  }
}
