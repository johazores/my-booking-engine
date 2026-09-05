import { listHospitalityBookings } from '@/server/bookings/hospitality-booking-service.ts';
import { hospitalityBookingApiError, hospitalityBookingJson, requireHospitalityBookingApiContext } from '@/server/bookings/hospitality-booking-http.ts';
import { createRequestObservation } from '@/server/observability/request-observability.ts';

export async function GET(request: Request) {
  const observation = createRequestObservation(request, { operation: 'booking.hospitality.list' });
  let organizationId: string | undefined;
  const finish = (response: Response) => observation.finish(response, { organizationId });

  try {
    const context = await requireHospitalityBookingApiContext(request);
    if (context.response) return finish(context.response);
    organizationId = context.organizationId;
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '25');
    const result = await listHospitalityBookings({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      page,
      pageSize,
    });
    return finish(hospitalityBookingJson(result));
  } catch (error) {
    return finish(hospitalityBookingApiError(error));
  }
}
