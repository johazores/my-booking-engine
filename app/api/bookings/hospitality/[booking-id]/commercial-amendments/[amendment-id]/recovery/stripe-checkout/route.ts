import { createOrResumeStripeHospitalityBookingCommercialAmendmentRecoveryCheckout } from '@/server/bookings/hospitality-booking-commercial-amendment-recovery-transport-service.ts';
import { hospitalityBookingApiError, hospitalityBookingJson, requireHospitalityBookingApiContext } from '@/server/bookings/hospitality-booking-http.ts';

type RouteContext = { params: Promise<{ 'booking-id': string; 'amendment-id': string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await requireHospitalityBookingApiContext(request, { write: true });
    if (auth.response) return auth.response;
    const params = await context.params;
    const bookingId = params['booking-id'];
    const amendmentId = params['amendment-id'];
    const returnUrl = new URL(`/bookings/${encodeURIComponent(bookingId)}`, request.url);
    const successUrl = new URL(returnUrl);
    successUrl.searchParams.set('commercialRecovery', 'returned');
    successUrl.searchParams.set('commercialAmendmentId', amendmentId);
    const cancelUrl = new URL(returnUrl);
    cancelUrl.searchParams.set('commercialRecovery', 'cancelled');
    cancelUrl.searchParams.set('commercialAmendmentId', amendmentId);
    const result = await createOrResumeStripeHospitalityBookingCommercialAmendmentRecoveryCheckout({
      organizationId: auth.organizationId,
      actorUserId: auth.actorUserId,
      bookingId,
      amendmentId,
      successUrl: successUrl.toString(),
      cancelUrl: cancelUrl.toString(),
    });
    return hospitalityBookingJson(result, 'checkoutUrl' in result && result.checkoutUrl ? 201 : 200);
  } catch (error) {
    return hospitalityBookingApiError(error);
  }
}
