import { createRequestObservation } from '@/server/observability/request-observability.ts';
import { executeStripeHospitalityBookingCommercialAmendmentRefundTransport } from '@/server/bookings/hospitality-booking-commercial-amendment-transport-service.ts';
import {
  hospitalityBookingApiError,
  hospitalityBookingJson,
  readHospitalityBookingJsonObject,
  requireHospitalityBookingApiContext,
} from '@/server/bookings/hospitality-booking-http.ts';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ 'booking-id': string; 'amendment-id': string }> },
) {
  const observation = createRequestObservation(request, { operation: 'payment.commercial-amendment.stripe-refund.create' });
  let organizationId: string | undefined;
  const finish = (response: Response) => observation.finish(response, { organizationId, provider: 'stripe' });

  try {
    const context = await requireHospitalityBookingApiContext(request, { write: true });
    if (context.response) return finish(context.response);
    organizationId = context.organizationId;
    const route = await params;
    const payload = await readHospitalityBookingJsonObject(request);
    const amendment = await executeStripeHospitalityBookingCommercialAmendmentRefundTransport({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      bookingId: route['booking-id'],
      amendmentId: route['amendment-id'],
      idempotencyKey: payload.idempotencyKey,
    });
    return finish(hospitalityBookingJson(amendment));
  } catch (error) {
    return finish(hospitalityBookingApiError(error));
  }
}
