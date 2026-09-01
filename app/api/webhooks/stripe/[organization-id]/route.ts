import { PaymentConflictError } from '@/server/payments/payment-service.ts';
import { StripeWebhookRequestError, ingestStripePaymentWebhook } from '@/server/payments/stripe-webhook-service.ts';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ 'organization-id': string }> },
) {
  try {
    const routeParams = await params;
    const payload = await request.text();
    await ingestStripePaymentWebhook({
      organizationId: routeParams['organization-id'],
      signature: request.headers.get('stripe-signature'),
      payload,
    });
    return Response.json({ received: true });
  } catch (error) {
    if (error instanceof StripeWebhookRequestError) {
      if (error.code === 'CONFIGURATION') return Response.json({ error: 'webhook-unavailable' }, { status: 503 });
      return Response.json({ error: 'invalid-webhook' }, { status: 400 });
    }
    if (error instanceof PaymentConflictError) return Response.json({ error: 'webhook-conflict' }, { status: 409 });
    if (error instanceof Error && /organizationId|UUID/i.test(error.message)) {
      return Response.json({ error: 'invalid-webhook' }, { status: 400 });
    }
    return Response.json({ error: 'internal-error' }, { status: 500 });
  }
}
