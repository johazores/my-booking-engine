import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { StripePaymentProvider } from '../payments/stripe-payment-provider.ts';
import { StripePaymentReconciliationProvider } from '../payments/stripe-payment-reconciliation-provider.ts';
import { StripeRefundReconciliationProvider } from '../payments/stripe-refund-reconciliation-provider.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { loadActiveIntegrationCredentials } from './integration-service.ts';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const DEFAULT_HEALTH_TIMEOUT_MS = 10_000;

export class StripeIntegrationConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StripeIntegrationConfigurationError';
  }
}

export type StripeIntegrationHealthStatus =
  | 'HEALTHY'
  | 'AUTHENTICATION_FAILED'
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'INVALID_RESPONSE';

export type StripeIntegrationHealthResult = Readonly<{
  status: StripeIntegrationHealthStatus;
}>;

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

export async function probeStripeIntegrationHealth(input: {
  secretKey: unknown;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<StripeIntegrationHealthResult> {
  const configuration = normalizeStripeIntegrationConfiguration({ secretKey: input.secretKey });
  const timeoutMs = input.timeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
    throw new StripeIntegrationConfigurationError('Stripe health timeout must be between 1000 and 120000 milliseconds.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (input.fetchImpl ?? fetch)(`${STRIPE_API_BASE}/balance`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${configuration.credentials.secretKey}` },
      signal: controller.signal,
      cache: 'no-store',
    });

    if (response.status === 401 || response.status === 403) return Object.freeze({ status: 'AUTHENTICATION_FAILED' });
    if (response.status === 429) return Object.freeze({ status: 'RATE_LIMITED' });
    if (response.status >= 500) return Object.freeze({ status: 'PROVIDER_UNAVAILABLE' });
    if (!response.ok) return Object.freeze({ status: 'INVALID_RESPONSE' });

    const payload = await response.json().catch(() => null) as { object?: unknown } | null;
    return Object.freeze({ status: payload?.object === 'balance' ? 'HEALTHY' : 'INVALID_RESPONSE' });
  } catch {
    return Object.freeze({ status: 'PROVIDER_UNAVAILABLE' });
  } finally {
    clearTimeout(timeout);
  }
}

export async function testStripeIntegrationConnection(input: {
  organizationId: string;
  actorUserId: string;
  fetchImpl?: typeof fetch;
}): Promise<StripeIntegrationHealthResult> {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'integration:manage',
  });

  const { integration, credentials } = await loadActiveIntegrationCredentials({
    organizationId: input.organizationId,
    providerCode: 'stripe',
  });
  const result = await probeStripeIntegrationHealth({
    secretKey: credentials.secretKey,
    fetchImpl: input.fetchImpl,
  });

  await db.auditEvent.create({
    data: {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: 'integration.connection-tested',
      resourceType: 'integration',
      resourceId: integration.id,
      afterData: {
        providerCode: integration.providerCode,
        result: result.status,
        credentialVersion: integration.credentialVersion,
      },
    },
  });

  return result;
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
