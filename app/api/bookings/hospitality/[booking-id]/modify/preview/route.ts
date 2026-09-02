import { previewHospitalityBookingCommercialAdjustment } from '@/server/bookings/hospitality-booking-commercial-adjustment-preview-service.ts';
import {
  hospitalityBookingApiError,
  hospitalityBookingJson,
  requireHospitalityBookingApiContext,
} from '@/server/bookings/hospitality-booking-http.ts';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ 'booking-id': string }> },
) {
  try {
    const context = await requireHospitalityBookingApiContext(request, { write: true });
    if (context.response) return context.response;
    const bookingId = (await params)['booking-id'];
    const change = await request.json();
    const preview = await previewHospitalityBookingCommercialAdjustment({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      bookingId,
      change,
    });
    return hospitalityBookingJson(preview);
  } catch (error) {
    return hospitalityBookingApiError(error);
  }
}
