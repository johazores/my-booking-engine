import { confirmHospitalityBookingFromHold } from '@/server/bookings/hospitality-booking-service.ts';
import { hospitalityBookingApiError, hospitalityBookingJson, requireHospitalityBookingApiContext } from '@/server/bookings/hospitality-booking-http.ts';
import { createRequestObservation } from '@/server/observability/request-observability.ts';

export async function POST(request: Request) {
  const observation = createRequestObservation(request, { operation: 'booking.hospitality-confirmation.create' });
  let organizationId: string | undefined;
  const finish = (response: Response) => observation.finish(response, { organizationId });

  try {
    const context = await requireHospitalityBookingApiContext(request, { write: true });
    if (context.response) return finish(context.response);
    organizationId = context.organizationId;
    const body = await request.json();
    const booking = await confirmHospitalityBookingFromHold({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      confirmation: body,
    });
    return finish(hospitalityBookingJson(booking, 201));
  } catch (error) {
    return finish(hospitalityBookingApiError(error));
  }
}
