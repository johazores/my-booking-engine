import { readHospitalityAvailability } from '@/server/availability/hospitality-availability-service.ts';
import { hospitalityBookingApiError, hospitalityBookingJson, requireHospitalityBookingApiContext } from '@/server/bookings/hospitality-booking-http.ts';

export async function POST(request: Request) {
  try {
    const context = await requireHospitalityBookingApiContext(request, { write: true });
    if (context.response) return context.response;
    const body = await request.json();
    const availability = await readHospitalityAvailability({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      request: body,
    });
    return hospitalityBookingJson(availability);
  } catch (error) {
    return hospitalityBookingApiError(error);
  }
}
