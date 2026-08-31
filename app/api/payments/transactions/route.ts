import { paymentApiError, paymentJson, requirePaymentApiContext } from '@/server/payments/payment-http.ts';
import { listBookingPaymentTransactions } from '@/server/payments/payment-service.ts';

export async function GET(request: Request) {
  try {
    const context = await requirePaymentApiContext(request);
    if (context.response) return context.response;
    const url = new URL(request.url);
    const result = await listBookingPaymentTransactions({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      bookingId: url.searchParams.get('bookingId') ?? '',
      page: Number(url.searchParams.get('page') ?? '1'),
      pageSize: Number(url.searchParams.get('pageSize') ?? '25'),
    });
    return paymentJson(result);
  } catch (error) {
    return paymentApiError(error);
  }
}
