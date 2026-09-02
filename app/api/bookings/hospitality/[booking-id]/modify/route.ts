import {
  getHospitalityBookingCommercialModificationOptions,
  modifyHospitalityBookingCommercialTerms,
} from '@/server/bookings/hospitality-booking-commercial-modification-service.ts';
import {
  hospitalityBookingApiError,
  hospitalityBookingJson,
  requireHospitalityBookingApiContext,
} from '@/server/bookings/hospitality-booking-http.ts';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ 'booking-id': string }> },
) {
  try {
    const context = await requireHospitalityBookingApiContext(request);
    if (context.response) return context.response;
    const bookingId = (await params)['booking-id'];
    const options = await getHospitalityBookingCommercialModificationOptions({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      bookingId,
    });
    return hospitalityBookingJson(options);
  } catch (error) {
    return hospitalityBookingApiError(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ 'booking-id': string }> },
) {
  try {
    const context = await requireHospitalityBookingApiContext(request, { write: true });
    if (context.response) return context.response;
    const bookingId = (await params)['booking-id'];
    const change = await request.json();
    const booking = await modifyHospitalityBookingCommercialTerms({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      bookingId,
      change,
    });
    return hospitalityBookingJson(booking);
  } catch (error) {
    return hospitalityBookingApiError(error);
  }
}
