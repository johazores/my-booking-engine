import { createRequestObservation } from '@/server/observability/request-observability.ts';
import { paymentApiError, paymentJson, requirePaymentApiContext } from '@/server/payments/payment-http.ts';
import { recordManualOfflineRefund } from '@/server/payments/payment-service.ts';

export async function POST(request: Request) {
  const observation = createRequestObservation(request, { operation: 'payment.manual-refund.record' });
  let organizationId: string | undefined;
  const finish = (response: Response) => observation.finish(response, { organizationId, provider: 'manual' });

  try {
    const context = await requirePaymentApiContext(request, { write: true });
    if (context.response) return finish(context.response);
    organizationId = context.organizationId;
    const body = await request.json();
    const refund = await recordManualOfflineRefund({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      bookingId: body?.bookingId,
      idempotencyKey: body?.idempotencyKey,
      reference: body?.reference,
      amountMinor: body?.amountMinor,
    });
    return finish(paymentJson(refund, 201));
  } catch (error) {
    return finish(paymentApiError(error));
  }
}
