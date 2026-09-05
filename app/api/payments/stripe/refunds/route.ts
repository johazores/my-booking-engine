import { createRequestObservation } from '@/server/observability/request-observability.ts';
import { paymentApiError, paymentJson, requirePaymentApiContext } from '@/server/payments/payment-http.ts';
import { refundStripeBookingPayment } from '@/server/payments/stripe-refund-service.ts';

export async function POST(request: Request) {
  const observation = createRequestObservation(request, { operation: 'payment.stripe-refund.create' });
  let organizationId: string | undefined;
  const finish = (response: Response) => observation.finish(response, { organizationId, provider: 'stripe' });

  try {
    const context = await requirePaymentApiContext(request, { write: true });
    if (context.response) return finish(context.response);
    organizationId = context.organizationId;
    const body = await request.json();
    const refund = await refundStripeBookingPayment({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      bookingId: body?.bookingId,
      idempotencyKey: body?.idempotencyKey,
      amountMinor: body?.amountMinor,
    });
    return finish(paymentJson(refund));
  } catch (error) {
    return finish(paymentApiError(error));
  }
}
