import { paymentApiError, paymentJson, requirePaymentApiContext } from '@/server/payments/payment-http.ts';
import { refundStripeBookingPayment } from '@/server/payments/stripe-refund-service.ts';

export async function POST(request: Request) {
  try {
    const context = await requirePaymentApiContext(request, { write: true });
    if (context.response) return context.response;
    const body = await request.json();
    const refund = await refundStripeBookingPayment({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      bookingId: body?.bookingId,
      idempotencyKey: body?.idempotencyKey,
      amountMinor: body?.amountMinor,
    });
    return paymentJson(refund);
  } catch (error) {
    return paymentApiError(error);
  }
}
