import type { HospitalityBookingCommercialModificationInput } from '@/server/bookings/booking-commercial-modification-domain.ts';
import {
  findHospitalityBookingCommercialAmendmentTransport,
  prepareHospitalityBookingCommercialAmendmentTransport,
} from '@/server/bookings/hospitality-booking-commercial-amendment-transport-service.ts';
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
  try {
    const context = await requireHospitalityBookingApiContext(request);
    if (context.response) return context.response;
    const bookingId = (await params)['booking-id'];
    const amendment = await findHospitalityBookingCommercialAmendmentTransport({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      bookingId,
    });
    return hospitalityBookingJson({ amendment });
  } catch (error) {
    return hospitalityBookingApiError(error);
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
    const body = await request.json().catch(() => { throw new Error('Commercial amendment request must be valid JSON.'); });
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Commercial amendment request must be an object.');
    const payload = body as { change?: unknown; adjustmentFingerprint?: unknown };
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
