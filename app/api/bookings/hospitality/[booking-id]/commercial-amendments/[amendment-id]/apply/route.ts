import { applyHospitalityBookingCommercialAmendmentTransport } from '@/server/bookings/hospitality-booking-commercial-amendment-transport-service.ts';
import {
  hospitalityBookingApiError,
  hospitalityBookingJson,
  requireHospitalityBookingApiContext,
} from '@/server/bookings/hospitality-booking-http.ts';
import { createRequestObservation } from '@/server/observability/request-observability.ts';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ 'booking-id': string; 'amendment-id': string }> },
) {
  const observation = createRequestObservation(request, { operation: 'booking.hospitality-commercial-amendment.apply' });
  let organizationId: string | undefined;
  const finish = (response: Response) => observation.finish(response, { organizationId });

  try {
    const context = await requireHospitalityBookingApiContext(request, { write: true });
    if (context.response) return finish(context.response);
    organizationId = context.organizationId;
    const route = await params;
    const amendment = await applyHospitalityBookingCommercialAmendmentTransport({
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
