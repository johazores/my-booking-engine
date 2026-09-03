import { executeStripeHospitalityBookingCommercialAmendmentRefundTransport } from '@/server/bookings/hospitality-booking-commercial-amendment-transport-service.ts';
import {
  hospitalityBookingApiError,
  hospitalityBookingJson,
  requireHospitalityBookingApiContext,
} from '@/server/bookings/hospitality-booking-http.ts';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ 'booking-id': string; 'amendment-id': string }> },
) {
  try {
    const context = await requireHospitalityBookingApiContext(request, { write: true });
    if (context.response) return context.response;
    const route = await params;
    const body = await request.json().catch(() => { throw new Error('Stripe refund request must be valid JSON.'); });
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Stripe refund request must be an object.');
    const payload = body as { idempotencyKey?: unknown };
    const amendment = await executeStripeHospitalityBookingCommercialAmendmentRefundTransport({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      bookingId: route['booking-id'],
      amendmentId: route['amendment-id'],
      idempotencyKey: payload.idempotencyKey,
    });
    return hospitalityBookingJson(amendment);
  } catch (error) {
    return hospitalityBookingApiError(error);
  }
}
