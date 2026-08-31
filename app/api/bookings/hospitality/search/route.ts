import { hospitalityBookingApiError, hospitalityBookingJson, requireHospitalityBookingApiContext } from '@/server/bookings/hospitality-booking-http.ts';
import { searchHospitalityOffers } from '@/server/bookings/hospitality-search-service.ts';

export async function POST(request: Request) {
  try {
    const context = await requireHospitalityBookingApiContext(request, { write: true });
    if (context.response) return context.response;
    const body = await request.json();
    const results = await searchHospitalityOffers({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      search: body,
    });
    return hospitalityBookingJson(results);
  } catch (error) {
    return hospitalityBookingApiError(error);
  }
}
