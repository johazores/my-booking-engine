import { createRequestObservation } from '@/server/observability/request-observability.ts';
import { paymentApiError, paymentJson, requirePaymentApiContext } from '@/server/payments/payment-http.ts';
import { reconcileStripeRefundTransaction } from '@/server/payments/stripe-refund-reconciliation-service.ts';

export async function POST(request: Request) {
  const observation = createRequestObservation(request, { operation: 'payment.stripe-refund.reconcile' });
  let organizationId: string | undefined;
  const finish = (response: Response) => observation.finish(response, { organizationId, provider: 'stripe' });

  try {
    const context = await requirePaymentApiContext(request, { write: true });
    if (context.response) return finish(context.response);
    organizationId = context.organizationId;
    const body = await request.json();
    const refund = await reconcileStripeRefundTransaction({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      transactionId: body?.transactionId,
    });
    return finish(paymentJson(refund));
  } catch (error) {
    return finish(paymentApiError(error));
  }
}
