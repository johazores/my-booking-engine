import { reconcileStripeHospitalityBookingCommercialAmendmentRefundTransport } from '@/server/bookings/hospitality-booking-commercial-amendment-transport-service.ts';
import {
  hospitalityBookingApiError,
  hospitalityBookingJson,
  requireHospitalityBookingApiContext,
} from '@/server/bookings/hospitality-booking-http.ts';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ 'booking-id': string; 'amendment-id': string }> },
) {
  try {
    const context = await requireHospitalityBookingApiContext(request, { write: true });
    if (context.response) return context.response;
    const route = await params;
    const amendment = await reconcileStripeHospitalityBookingCommercialAmendmentRefundTransport({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      bookingId: route['booking-id'],
      amendmentId: route['amendment-id'],
    });
    return hospitalityBookingJson(amendment);
  } catch (error) {
    return hospitalityBookingApiError(error);
  }
}
