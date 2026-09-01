import { updateHospitalityBookingGuests } from '@/server/bookings/hospitality-booking-guest-modification-service.ts';
import { hospitalityBookingApiError, hospitalityBookingJson, requireHospitalityBookingApiContext } from '@/server/bookings/hospitality-booking-http.ts';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ 'booking-id': string }> },
) {
  try {
    const context = await requireHospitalityBookingApiContext(request, { write: true });
    if (context.response) return context.response;
    const bookingId = (await params)['booking-id'];
    const change = await request.json() as { idempotencyKey: string; guests: Array<{ firstName: string; lastName: string; email?: string | null }> };
    const result = await updateHospitalityBookingGuests({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      bookingId,
      change,
    });
    return hospitalityBookingJson(result);
  } catch (error) {
    return hospitalityBookingApiError(error);
  }
}
