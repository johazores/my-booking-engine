import { createHospitalityAvailabilityHold } from '@/server/availability/hospitality-availability-hold-service.ts';
import { hospitalityBookingApiError, hospitalityBookingJson, requireHospitalityBookingApiContext } from '@/server/bookings/hospitality-booking-http.ts';
import { createRequestObservation } from '@/server/observability/request-observability.ts';

export async function POST(request: Request) {
  const observation = createRequestObservation(request, { operation: 'booking.hospitality-hold.create' });
  let organizationId: string | undefined;
  const finish = (response: Response) => observation.finish(response, { organizationId });

  try {
    const context = await requireHospitalityBookingApiContext(request, { write: true });
    if (context.response) return finish(context.response);
    organizationId = context.organizationId;
    const body = await request.json();
    const hold = await createHospitalityAvailabilityHold({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      hold: body,
    });
    return finish(hospitalityBookingJson(hold, 201));
  } catch (error) {
    return finish(hospitalityBookingApiError(error));
  }
}
