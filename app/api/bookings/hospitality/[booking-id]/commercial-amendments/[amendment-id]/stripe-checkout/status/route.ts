import { reconcileStripeHospitalityBookingCommercialAmendmentCheckoutTransport } from '@/server/bookings/hospitality-booking-commercial-amendment-stripe-checkout-transport-service.ts';
import { hospitalityBookingApiError, hospitalityBookingJson, requireHospitalityBookingApiContext } from '@/server/bookings/hospitality-booking-http.ts';

type RouteContext = { params: Promise<{ 'booking-id': string; 'amendment-id': string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await requireHospitalityBookingApiContext(request, { write: true });
    if (auth.response) return auth.response;
    const params = await context.params;
    const result = await reconcileStripeHospitalityBookingCommercialAmendmentCheckoutTransport({
      organizationId: auth.organizationId,
      actorUserId: auth.actorUserId,
      bookingId: params['booking-id'],
      amendmentId: params['amendment-id'],
    });
    return hospitalityBookingJson(result);
  } catch (error) {
    return hospitalityBookingApiError(error);
  }
}
