import { paymentApiError, paymentJson, requirePaymentApiContext } from '@/server/payments/payment-http.ts';
import { reconcileStripePaymentTransaction } from '@/server/payments/stripe-reconciliation-service.ts';

export async function POST(request: Request) {
  try {
    const context = await requirePaymentApiContext(request, { write: true });
    if (context.response) return context.response;
    const body = await request.json();
    const payment = await reconcileStripePaymentTransaction({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      transactionId: body?.transactionId,
    });
    return paymentJson(payment);
  } catch (error) {
    return paymentApiError(error);
  }
}
