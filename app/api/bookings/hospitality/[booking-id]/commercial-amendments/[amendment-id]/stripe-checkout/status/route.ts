import { createRequestObservation } from '@/server/observability/request-observability.ts';
import { reconcileStripeHospitalityBookingCommercialAmendmentCheckoutTransport } from '@/server/bookings/hospitality-booking-commercial-amendment-stripe-checkout-transport-service.ts';
import { hospitalityBookingApiError, hospitalityBookingJson, requireHospitalityBookingApiContext } from '@/server/bookings/hospitality-booking-http.ts';

type RouteContext = { params: Promise<{ 'booking-id': string; 'amendment-id': string }> };

export async function POST(request: Request, context: RouteContext) {
  const observation = createRequestObservation(request, { operation: 'payment.commercial-amendment.stripe-checkout.reconcile' });
  let organizationId: string | undefined;
  const finish = (response: Response) => observation.finish(response, { organizationId, provider: 'stripe' });

  try {
    const auth = await requireHospitalityBookingApiContext(request, { write: true });
    if (auth.response) return finish(auth.response);
    organizationId = auth.organizationId;
    const params = await context.params;
    const result = await reconcileStripeHospitalityBookingCommercialAmendmentCheckoutTransport({
      organizationId: auth.organizationId,
      actorUserId: auth.actorUserId,
      bookingId: params['booking-id'],
      amendmentId: params['amendment-id'],
    });
    return finish(hospitalityBookingJson(result));
  } catch (error) {
    return finish(hospitalityBookingApiError(error));
  }
}
