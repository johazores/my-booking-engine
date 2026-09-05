import { createRequestObservation } from '@/server/observability/request-observability.ts';
import { paymentApiError, paymentJson, requirePaymentApiContext } from '@/server/payments/payment-http.ts';
import { getBookingPaymentReceipt } from '@/server/payments/payment-receipt-service.ts';

export async function GET(request: Request) {
  const observation = createRequestObservation(request, { operation: 'payment.receipt.read' });
  let organizationId: string | undefined;
  const finish = (response: Response) => observation.finish(response, { organizationId });

  try {
    const context = await requirePaymentApiContext(request);
    if (context.response) return finish(context.response);
    organizationId = context.organizationId;

    const url = new URL(request.url);
    const receipt = await getBookingPaymentReceipt({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      bookingId: url.searchParams.get('bookingId') ?? '',
    });

    return finish(paymentJson(receipt));
  } catch (error) {
    return finish(paymentApiError(error));
  }
}
