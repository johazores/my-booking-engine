import { createRequestObservation } from '@/server/observability/request-observability.ts';
import { paymentApiError, paymentJson, requirePaymentApiContext } from '@/server/payments/payment-http.ts';
import { listBookingPaymentTransactions } from '@/server/payments/payment-service.ts';

export async function GET(request: Request) {
  const observation = createRequestObservation(request, { operation: 'payment.transactions.read' });
  let organizationId: string | undefined;
  const finish = (response: Response) => observation.finish(response, { organizationId });

  try {
    const context = await requirePaymentApiContext(request);
    if (context.response) return finish(context.response);
    organizationId = context.organizationId;
    const url = new URL(request.url);
    const result = await listBookingPaymentTransactions({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      bookingId: url.searchParams.get('bookingId') ?? '',
      page: Number(url.searchParams.get('page') ?? '1'),
      pageSize: Number(url.searchParams.get('pageSize') ?? '25'),
    });
    return finish(paymentJson(result));
  } catch (error) {
    return finish(paymentApiError(error));
  }
}
