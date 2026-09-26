import { previewHospitalityBookingCommercialAdjustment } from '@/server/bookings/hospitality-booking-commercial-adjustment-preview-service.ts';
import {
  hospitalityBookingApiError,
  hospitalityBookingJson,
  readHospitalityBookingJsonObject,
  requireHospitalityBookingApiContext,
} from '@/server/bookings/hospitality-booking-http.ts';
import { createRequestObservation } from '@/server/observability/request-observability.ts';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ 'booking-id': string }> },
) {
  const observation = createRequestObservation(request, { operation: 'booking.hospitality-commercial-modification.preview' });
  let organizationId: string | undefined;
  const finish = (response: Response) => observation.finish(response, { organizationId });

  try {
    const context = await requireHospitalityBookingApiContext(request, { write: true });
    if (context.response) return finish(context.response);
    organizationId = context.organizationId;
    const bookingId = (await params)['booking-id'];
    const change = await readHospitalityBookingJsonObject(request) as Parameters<typeof previewHospitalityBookingCommercialAdjustment>[0]['change'];
    const preview = await previewHospitalityBookingCommercialAdjustment({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      bookingId,
      change,
    });
    return finish(hospitalityBookingJson(preview));
  } catch (error) {
    return finish(hospitalityBookingApiError(error));
  }
}
