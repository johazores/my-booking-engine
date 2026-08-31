import { paymentApiError, paymentJson, requirePaymentApiContext } from '@/server/payments/payment-http.ts';
import { recordManualOfflineRefund } from '@/server/payments/payment-service.ts';

export async function POST(request: Request) {
  try {
    const context = await requirePaymentApiContext(request, { write: true });
    if (context.response) return context.response;
    const body = await request.json();
    const refund = await recordManualOfflineRefund({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      bookingId: body?.bookingId,
      idempotencyKey: body?.idempotencyKey,
      reference: body?.reference,
      amountMinor: body?.amountMinor,
    });
    return paymentJson(refund, 201);
  } catch (error) {
    return paymentApiError(error);
  }
}
