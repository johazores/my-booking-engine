import { createRequestObservation } from '@/server/observability/request-observability.ts';
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
  const observation = createRequestObservation(request, { operation: 'payment.commercial-amendment.stripe-refund.reconcile' });
  let organizationId: string | undefined;
  const finish = (response: Response) => observation.finish(response, { organizationId, provider: 'stripe' });

  try {
    const context = await requireHospitalityBookingApiContext(request, { write: true });
    if (context.response) return finish(context.response);
    organizationId = context.organizationId;
    const route = await params;
    const amendment = await reconcileStripeHospitalityBookingCommercialAmendmentRefundTransport({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      bookingId: route['booking-id'],
      amendmentId: route['amendment-id'],
    });
    return finish(hospitalityBookingJson(amendment));
  } catch (error) {
    return finish(hospitalityBookingApiError(error));
  }
}
