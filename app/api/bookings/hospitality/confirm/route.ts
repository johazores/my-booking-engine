import { confirmHospitalityBookingFromHold } from '@/server/bookings/hospitality-booking-service.ts';
import { hospitalityBookingApiError, hospitalityBookingJson, requireHospitalityBookingApiContext } from '@/server/bookings/hospitality-booking-http.ts';

export async function POST(request: Request) {
  try {
    const context = await requireHospitalityBookingApiContext(request, { write: true });
    if (context.response) return context.response;
    const body = await request.json();
    const booking = await confirmHospitalityBookingFromHold({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      confirmation: body,
    });
    return hospitalityBookingJson(booking, 201);
  } catch (error) {
    return hospitalityBookingApiError(error);
  }
}
