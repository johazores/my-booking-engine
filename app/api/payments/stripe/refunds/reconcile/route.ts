import { paymentApiError, paymentJson, requirePaymentApiContext } from '@/server/payments/payment-http.ts';
import { reconcileStripeRefundTransaction } from '@/server/payments/stripe-refund-reconciliation-service.ts';

export async function POST(request: Request) {
  try {
    const context = await requirePaymentApiContext(request, { write: true });
    if (context.response) return context.response;
    const body = await request.json();
    const refund = await reconcileStripeRefundTransaction({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      transactionId: body?.transactionId,
    });
    return paymentJson(refund);
  } catch (error) {
    return paymentApiError(error);
  }
}
