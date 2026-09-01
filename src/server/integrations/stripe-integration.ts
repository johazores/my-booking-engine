import { StripePaymentProvider } from '../payments/stripe-payment-provider.ts';
import { StripePaymentReconciliationProvider } from '../payments/stripe-payment-reconciliation-provider.ts';
import { StripeRefundReconciliationProvider } from '../payments/stripe-refund-reconciliation-provider.ts';
import { loadActiveIntegrationCredentials } from './integration-service.ts';

export async function loadStripePaymentIntegration(organizationId: string) {
  const { integration, credentials } = await loadActiveIntegrationCredentials({ organizationId, providerCode: 'stripe' });
  const secretKey = credentials.secretKey;
  if (!secretKey) throw new Error('Stripe integration is missing secretKey credentials.');
  const webhookSecret = credentials.webhookSecret;
  if (webhookSecret !== undefined && !webhookSecret.startsWith('whsec_')) {
    throw new Error('Stripe integration webhookSecret is invalid.');
  }
  return Object.freeze({
    integration,
    provider: new StripePaymentProvider({ secretKey }),
    reconciliationProvider: new StripePaymentReconciliationProvider({ secretKey }),
    refundReconciliationProvider: new StripeRefundReconciliationProvider({ secretKey }),
    webhookSecret,
  });
}
