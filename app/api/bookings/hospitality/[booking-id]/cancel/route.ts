import { cancelHospitalityBooking } from '@/server/bookings/hospitality-booking-cancellation-service.ts';
import { hospitalityBookingApiError, hospitalityBookingJson, requireHospitalityBookingApiContext } from '@/server/bookings/hospitality-booking-http.ts';
import { createRequestObservation } from '@/server/observability/request-observability.ts';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ 'booking-id': string }> },
) {
  const observation = createRequestObservation(request, { operation: 'booking.hospitality-cancellation.apply' });
  let organizationId: string | undefined;
  const finish = (response: Response) => observation.finish(response, { organizationId });

  try {
    const context = await requireHospitalityBookingApiContext(request, { write: true });
    if (context.response) return finish(context.response);
    organizationId = context.organizationId;
    const bookingId = (await params)['booking-id'];
    const booking = await cancelHospitalityBooking({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      bookingId,
    });
    return finish(hospitalityBookingJson(booking));
  } catch (error) {
    return finish(hospitalityBookingApiError(error));
  }
}
