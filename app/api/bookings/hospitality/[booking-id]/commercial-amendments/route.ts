import type { HospitalityBookingCommercialModificationInput } from '@/server/bookings/booking-commercial-modification-domain.ts';
import {
  findHospitalityBookingCommercialAmendmentTransport,
  prepareHospitalityBookingCommercialAmendmentTransport,
} from '@/server/bookings/hospitality-booking-commercial-amendment-transport-service.ts';
import {
  hospitalityBookingApiError,
  hospitalityBookingJson,
  readHospitalityBookingJsonObject,
  requireHospitalityBookingApiContext,
} from '@/server/bookings/hospitality-booking-http.ts';
import { createRequestObservation } from '@/server/observability/request-observability.ts';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ 'booking-id': string }> },
) {
  const observation = createRequestObservation(request, { operation: 'booking.hospitality-commercial-amendment.current.read' });
  let organizationId: string | undefined;
  const finish = (response: Response) => observation.finish(response, { organizationId });

  try {
    const context = await requireHospitalityBookingApiContext(request);
    if (context.response) return finish(context.response);
    organizationId = context.organizationId;
    const bookingId = (await params)['booking-id'];
    const amendment = await findHospitalityBookingCommercialAmendmentTransport({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      bookingId,
    });
    return finish(hospitalityBookingJson({ amendment }));
  } catch (error) {
    return finish(hospitalityBookingApiError(error));
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ 'booking-id': string }> },
) {
  const observation = createRequestObservation(request, { operation: 'booking.hospitality-commercial-amendment.prepare' });
  let organizationId: string | undefined;
  const finish = (response: Response) => observation.finish(response, { organizationId });

  try {
    const context = await requireHospitalityBookingApiContext(request, { write: true });
    if (context.response) return finish(context.response);
    organizationId = context.organizationId;
    const bookingId = (await params)['booking-id'];
    const payload = await readHospitalityBookingJsonObject(request);
    const amendment = await prepareHospitalityBookingCommercialAmendmentTransport({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      bookingId,
      change: payload.change as HospitalityBookingCommercialModificationInput,
      adjustmentFingerprint: payload.adjustmentFingerprint,
    });
    return finish(hospitalityBookingJson(amendment, 201));
  } catch (error) {
    return finish(hospitalityBookingApiError(error));
  }
}
