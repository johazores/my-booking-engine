import { paymentApiError, paymentJson, requirePaymentApiContext } from '@/server/payments/payment-http.ts';
import { getBookingPaymentReceipt } from '@/server/payments/payment-receipt-service.ts';

export async function GET(request: Request) {
  try {
    const context = await requirePaymentApiContext(request);
    if (context.response) return context.response;

    const url = new URL(request.url);
    const receipt = await getBookingPaymentReceipt({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      bookingId: url.searchParams.get('bookingId') ?? '',
    });

    return paymentJson(receipt);
  } catch (error) {
    return paymentApiError(error);
  }
}
