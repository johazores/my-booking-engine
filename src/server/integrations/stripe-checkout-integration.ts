import { StripeCheckoutProvider } from '../payments/stripe-checkout-provider.ts';
import { normalizeStripeIntegrationConfiguration } from './stripe-integration.ts';
import { loadActiveIntegrationCredentials } from './integration-service.ts';

export async function loadStripeCheckoutIntegration(organizationId: string) {
  const { integration, credentials } = await loadActiveIntegrationCredentials({ organizationId, providerCode: 'stripe' });
  const configuration = normalizeStripeIntegrationConfiguration({
    secretKey: credentials.secretKey,
    webhookSecret: credentials.webhookSecret,
  });
  return Object.freeze({
    integration,
    provider: new StripeCheckoutProvider({ secretKey: configuration.credentials.secretKey }),
  });
}
