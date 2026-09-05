import {
  getHospitalityBookingCommercialModificationOptions,
  modifyHospitalityBookingCommercialTerms,
} from '@/server/bookings/hospitality-booking-commercial-modification-service.ts';
import {
  hospitalityBookingApiError,
  hospitalityBookingJson,
  requireHospitalityBookingApiContext,
} from '@/server/bookings/hospitality-booking-http.ts';
import { createRequestObservation } from '@/server/observability/request-observability.ts';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ 'booking-id': string }> },
) {
  const observation = createRequestObservation(request, { operation: 'booking.hospitality-commercial-modification.options.read' });
  let organizationId: string | undefined;
  const finish = (response: Response) => observation.finish(response, { organizationId });

  try {
    const context = await requireHospitalityBookingApiContext(request);
    if (context.response) return finish(context.response);
    organizationId = context.organizationId;
    const bookingId = (await params)['booking-id'];
    const options = await getHospitalityBookingCommercialModificationOptions({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      bookingId,
    });
    return finish(hospitalityBookingJson(options));
  } catch (error) {
    return finish(hospitalityBookingApiError(error));
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ 'booking-id': string }> },
) {
  const observation = createRequestObservation(request, { operation: 'booking.hospitality-commercial-modification.apply' });
  let organizationId: string | undefined;
  const finish = (response: Response) => observation.finish(response, { organizationId });

  try {
    const context = await requireHospitalityBookingApiContext(request, { write: true });
    if (context.response) return finish(context.response);
    organizationId = context.organizationId;
    const bookingId = (await params)['booking-id'];
    const change = await request.json();
    const booking = await modifyHospitalityBookingCommercialTerms({
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
