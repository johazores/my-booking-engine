import { createRequestObservation } from '@/server/observability/request-observability.ts';
import { paymentApiError, paymentJson, requirePaymentApiContext } from '@/server/payments/payment-http.ts';
import { recordManualOfflinePayment } from '@/server/payments/payment-service.ts';

export async function POST(request: Request) {
  const observation = createRequestObservation(request, { operation: 'payment.manual.record' });
  let organizationId: string | undefined;
  const finish = (response: Response) => observation.finish(response, { organizationId, provider: 'manual' });

  try {
    const context = await requirePaymentApiContext(request, { write: true });
    if (context.response) return finish(context.response);
    organizationId = context.organizationId;
    const body = await request.json();
    const payment = await recordManualOfflinePayment({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      bookingId: body?.bookingId,
      idempotencyKey: body?.idempotencyKey,
      reference: body?.reference,
    });
    return finish(paymentJson(payment, 201));
  } catch (error) {
    return finish(paymentApiError(error));
  }
}
