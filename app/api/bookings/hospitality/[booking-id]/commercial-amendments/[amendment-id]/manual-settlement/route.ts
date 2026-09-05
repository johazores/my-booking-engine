import { createRequestObservation } from '@/server/observability/request-observability.ts';
import { recordManualHospitalityBookingCommercialAmendmentTransport } from '@/server/bookings/hospitality-booking-commercial-amendment-transport-service.ts';
import {
  hospitalityBookingApiError,
  hospitalityBookingJson,
  requireHospitalityBookingApiContext,
} from '@/server/bookings/hospitality-booking-http.ts';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ 'booking-id': string; 'amendment-id': string }> },
) {
  const observation = createRequestObservation(request, { operation: 'payment.commercial-amendment.manual-settlement' });
  let organizationId: string | undefined;
  const finish = (response: Response) => observation.finish(response, { organizationId, provider: 'manual' });

  try {
    const context = await requireHospitalityBookingApiContext(request, { write: true });
    if (context.response) return finish(context.response);
    organizationId = context.organizationId;
    const route = await params;
    const body = await request.json().catch(() => { throw new Error('Manual settlement request must be valid JSON.'); });
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Manual settlement request must be an object.');
    const payload = body as { idempotencyKey?: unknown; externalReference?: unknown };
    const amendment = await recordManualHospitalityBookingCommercialAmendmentTransport({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      bookingId: route['booking-id'],
      amendmentId: route['amendment-id'],
      idempotencyKey: payload.idempotencyKey,
      externalReference: payload.externalReference,
    });
    return finish(hospitalityBookingJson(amendment));
  } catch (error) {
    return finish(hospitalityBookingApiError(error));
  }
}
