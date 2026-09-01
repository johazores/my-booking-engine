import { cancelHospitalityBooking } from '@/server/bookings/hospitality-booking-cancellation-service.ts';
import { hospitalityBookingApiError, hospitalityBookingJson, requireHospitalityBookingApiContext } from '@/server/bookings/hospitality-booking-http.ts';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ 'booking-id': string }> },
) {
  try {
    const context = await requireHospitalityBookingApiContext(request, { write: true });
    if (context.response) return context.response;
    const bookingId = (await params)['booking-id'];
    const booking = await cancelHospitalityBooking({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      bookingId,
    });
    return hospitalityBookingJson(booking);
  } catch (error) {
    return hospitalityBookingApiError(error);
  }
}
