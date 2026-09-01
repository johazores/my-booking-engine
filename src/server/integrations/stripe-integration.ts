import { StripePaymentProvider } from '../payments/stripe-payment-provider.ts';
import { StripePaymentReconciliationProvider } from '../payments/stripe-payment-reconciliation-provider.ts';
import { StripeRefundReconciliationProvider } from '../payments/stripe-refund-reconciliation-provider.ts';
import { loadActiveIntegrationCredentials } from './integration-service.ts';

export class StripeIntegrationConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StripeIntegrationConfigurationError';
  }
}

export function normalizeStripeIntegrationConfiguration(input: { secretKey: unknown; webhookSecret?: unknown }) {
  if (typeof input.secretKey !== 'string') throw new StripeIntegrationConfigurationError('Stripe secret key is required.');
  const secretKey = input.secretKey.trim();
  if (!secretKey.startsWith('sk_') || secretKey.length < 12 || secretKey.length > 4096) {
    throw new StripeIntegrationConfigurationError('Stripe secret key is invalid.');
  }

  let webhookSecret: string | undefined;
  if (input.webhookSecret !== undefined && input.webhookSecret !== null && input.webhookSecret !== '') {
    if (typeof input.webhookSecret !== 'string') throw new StripeIntegrationConfigurationError('Stripe webhook secret is invalid.');
    webhookSecret = input.webhookSecret.trim();
    if (!webhookSecret.startsWith('whsec_') || webhookSecret.length > 4096) {
      throw new StripeIntegrationConfigurationError('Stripe webhook secret is invalid.');
    }
  }

  return Object.freeze({
    credentials: Object.freeze(webhookSecret ? { secretKey, webhookSecret } : { secretKey }),
    capabilities: Object.freeze(webhookSecret
      ? ['payment-authorize', 'payment-capture', 'payment-refund', 'webhooks']
      : ['payment-authorize', 'payment-capture', 'payment-refund']),
  });
}

export async function loadStripePaymentIntegration(organizationId: string) {
  const { integration, credentials } = await loadActiveIntegrationCredentials({ organizationId, providerCode: 'stripe' });
  const configuration = normalizeStripeIntegrationConfiguration({
    secretKey: credentials.secretKey,
    webhookSecret: credentials.webhookSecret,
  });
  return Object.freeze({
    integration,
    provider: new StripePaymentProvider({ secretKey: configuration.credentials.secretKey }),
    reconciliationProvider: new StripePaymentReconciliationProvider({ secretKey: configuration.credentials.secretKey }),
    refundReconciliationProvider: new StripeRefundReconciliationProvider({ secretKey: configuration.credentials.secretKey }),
    webhookSecret: 'webhookSecret' in configuration.credentials ? configuration.credentials.webhookSecret : undefined,
  });
}
