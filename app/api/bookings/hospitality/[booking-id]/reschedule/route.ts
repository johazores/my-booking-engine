import { rescheduleHospitalityBooking } from '@/server/bookings/hospitality-booking-reschedule-service.ts';
import { hospitalityBookingApiError, hospitalityBookingJson, requireHospitalityBookingApiContext } from '@/server/bookings/hospitality-booking-http.ts';
import { createRequestObservation } from '@/server/observability/request-observability.ts';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ 'booking-id': string }> },
) {
  const observation = createRequestObservation(request, { operation: 'booking.hospitality-reschedule.apply' });
  let organizationId: string | undefined;
  const finish = (response: Response) => observation.finish(response, { organizationId });

  try {
    const context = await requireHospitalityBookingApiContext(request, { write: true });
    if (context.response) return finish(context.response);
    organizationId = context.organizationId;
    const bookingId = (await params)['booking-id'];
    const change = await request.json() as { arrivalDate: string; departureDate: string; idempotencyKey: string };
    const booking = await rescheduleHospitalityBooking({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      bookingId,
      change,
    });
    return finish(hospitalityBookingJson(booking));
  } catch (error) {
    return finish(hospitalityBookingApiError(error));
  }
}
