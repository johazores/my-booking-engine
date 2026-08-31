import { listHospitalityBookings } from '@/server/bookings/hospitality-booking-service.ts';
import { hospitalityBookingApiError, hospitalityBookingJson, requireHospitalityBookingApiContext } from '@/server/bookings/hospitality-booking-http.ts';

export async function GET(request: Request) {
  try {
    const context = await requireHospitalityBookingApiContext(request);
    if (context.response) return context.response;
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '25');
    const result = await listHospitalityBookings({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      page,
      pageSize,
    });
    return hospitalityBookingJson(result);
  } catch (error) {
    return hospitalityBookingApiError(error);
  }
}
