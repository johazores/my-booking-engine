import { paymentApiError, paymentJson, requirePaymentApiContext } from '@/server/payments/payment-http.ts';
import { recordManualOfflinePayment } from '@/server/payments/payment-service.ts';

export async function POST(request: Request) {
  try {
    const context = await requirePaymentApiContext(request, { write: true });
    if (context.response) return context.response;
    const body = await request.json();
    const payment = await recordManualOfflinePayment({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      bookingId: body?.bookingId,
      idempotencyKey: body?.idempotencyKey,
      reference: body?.reference,
    });
    return paymentJson(payment, 201);
  } catch (error) {
    return paymentApiError(error);
  }
}
