import { finalizeVerifiedStripeCommercialAmendmentCheckoutWebhook } from '@/server/bookings/hospitality-booking-commercial-amendment-stripe-checkout-webhook-service.ts';
import { finalizeVerifiedStripeCommercialAmendmentRecoveryCheckoutWebhook } from '@/server/bookings/hospitality-booking-commercial-amendment-stripe-recovery-checkout-webhook-service.ts';
import { finalizeVerifiedStripeCommercialAmendmentRecoveryWebhook } from '@/server/bookings/hospitality-booking-commercial-amendment-stripe-recovery-webhook-service.ts';
import { finalizeVerifiedStripeCommercialAmendmentWebhook } from '@/server/bookings/hospitality-booking-commercial-amendment-stripe-webhook-service.ts';
import { createRequestObservation } from '@/server/observability/request-observability.ts';
import { PaymentConflictError } from '@/server/payments/payment-service.ts';
import { StripeWebhookRequestError, ingestStripePaymentWebhook } from '@/server/payments/stripe-webhook-service.ts';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ 'organization-id': string }> },
) {
  const observation = createRequestObservation(request, { operation: 'payment.stripe-webhook.ingest' });
  let verifiedOrganizationId: string | undefined;
  const finish = (response: Response) => observation.finish(response, {
    organizationId: verifiedOrganizationId,
    provider: 'stripe',
  });

  try {
    const routeParams = await params;
    const organizationId = routeParams['organization-id'];
    const payload = await request.text();
    const verifiedEvent = await ingestStripePaymentWebhook({
      organizationId,
      signature: request.headers.get('stripe-signature'),
      payload,
    });
    verifiedOrganizationId = organizationId;
    const checkoutFinalization = await finalizeVerifiedStripeCommercialAmendmentCheckoutWebhook({
      organizationId,
      verifiedWebhookEventId: verifiedEvent.id,
      payload,
    });
    if (!checkoutFinalization.handled) {
      const checkoutRecoveryFinalization = await finalizeVerifiedStripeCommercialAmendmentRecoveryCheckoutWebhook({
        organizationId,
        verifiedWebhookEventId: verifiedEvent.id,
        payload,
      });
      if (!checkoutRecoveryFinalization.handled) {
        const recoveryFinalization = await finalizeVerifiedStripeCommercialAmendmentRecoveryWebhook({
          organizationId,
          verifiedWebhookEventId: verifiedEvent.id,
          payload,
        });
        if (!recoveryFinalization.handled) {
          await finalizeVerifiedStripeCommercialAmendmentWebhook({
            organizationId,
            verifiedWebhookEventId: verifiedEvent.id,
            payload,
          });
        }
      }
    }
    return finish(Response.json({ received: true }));
  } catch (error) {
    if (error instanceof StripeWebhookRequestError) {
      if (error.code === 'CONFIGURATION') return finish(Response.json({ error: 'webhook-unavailable' }, { status: 503 }));
      return finish(Response.json({ error: 'invalid-webhook' }, { status: 400 }));
    }
    if (error instanceof PaymentConflictError) return finish(Response.json({ error: 'webhook-conflict' }, { status: 409 }));
    if (error instanceof Error && /organizationId|UUID/i.test(error.message)) {
      return finish(Response.json({ error: 'invalid-webhook' }, { status: 400 }));
    }
    return finish(Response.json({ error: 'internal-error' }, { status: 500 }));
  }
}
