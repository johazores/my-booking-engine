import { quoteHospitalityPrice } from '@/server/pricing/hospitality-pricing-service.ts';
import { hospitalityBookingApiError, hospitalityBookingJson, requireHospitalityBookingApiContext } from '@/server/bookings/hospitality-booking-http.ts';

export async function POST(request: Request) {
  try {
    const context = await requireHospitalityBookingApiContext(request, { write: true });
    if (context.response) return context.response;
    const body = await request.json();
    const quote = await quoteHospitalityPrice({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      request: body.request,
      addonSelections: body.addonSelections,
    });
    return hospitalityBookingJson(quote);
  } catch (error) {
    return hospitalityBookingApiError(error);
  }
}
