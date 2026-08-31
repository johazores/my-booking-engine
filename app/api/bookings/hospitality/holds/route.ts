import { createHospitalityAvailabilityHold } from '@/server/availability/hospitality-availability-hold-service.ts';
import { hospitalityBookingApiError, hospitalityBookingJson, requireHospitalityBookingApiContext } from '@/server/bookings/hospitality-booking-http.ts';

export async function POST(request: Request) {
  try {
    const context = await requireHospitalityBookingApiContext(request, { write: true });
    if (context.response) return context.response;
    const body = await request.json();
    const hold = await createHospitalityAvailabilityHold({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      hold: body,
    });
    return hospitalityBookingJson(hold, 201);
  } catch (error) {
    return hospitalityBookingApiError(error);
  }
}
