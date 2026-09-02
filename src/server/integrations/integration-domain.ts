export const integrationCapabilities = [
  'payment-authorize',
  'payment-capture',
  'payment-refund',
  'webhooks',
  'flight-search',
  'hotel-search',
  'availability',
  'pricing',
  'reservation',
  'ticketing',
  'modification',
  'cancellation',
  'refund',
] as const;

export type IntegrationCapability = (typeof integrationCapabilities)[number];

export const integrationHealthStatuses = [
  'HEALTHY',
  'AUTHENTICATION_FAILED',
  'RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
  'INVALID_RESPONSE',
] as const;

export type IntegrationHealthStatus = (typeof integrationHealthStatuses)[number];
export type IntegrationHealthSnapshot = Readonly<{
  status: IntegrationHealthStatus;
  checkedAt: Date;
}>;

const capabilitySet = new Set<string>(integrationCapabilities);
const healthStatusSet = new Set<string>(integrationHealthStatuses);

export function normalizeIntegrationProviderCode(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Integration provider code is required.');
  const code = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(code)) throw new Error('Integration provider code is invalid.');
  return code;
}

export function normalizeIntegrationDisplayName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Integration display name is required.');
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 120) throw new Error('Integration display name must be between 2 and 120 characters.');
  return name;
}

export function normalizeIntegrationCapabilities(value: unknown): IntegrationCapability[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('Integration capabilities are required.');
  const normalized = [...new Set(value.map((entry) => {
    if (typeof entry !== 'string') throw new Error('Integration capability is invalid.');
    const capability = entry.trim().toLowerCase();
    if (!capabilitySet.has(capability)) throw new Error(`Unsupported integration capability: ${capability || 'empty'}.`);
    return capability as IntegrationCapability;
  }))].sort();
  return normalized;
}

export function readCurrentIntegrationHealth(input: {
  integrationStatus: string;
  credentialVersion: number;
  event: { createdAt: Date; afterData: unknown } | null;
}): IntegrationHealthSnapshot | null {
  if (input.integrationStatus === 'ARCHIVED' || !input.event) return null;
  const payload = input.event.afterData;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const result = 'result' in payload ? payload.result : null;
  const credentialVersion = 'credentialVersion' in payload ? payload.credentialVersion : null;
  if (typeof result !== 'string' || !healthStatusSet.has(result)) return null;
  if (credentialVersion !== input.credentialVersion) return null;
  return Object.freeze({
    status: result as IntegrationHealthStatus,
    checkedAt: input.event.createdAt,
  });
}

export function publicIntegrationRecord<T extends {
  id: string;
  organizationId: string;
  providerCode: string;
  displayName: string;
  status: string;
  capabilities: string[];
  credentialVersion: number;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}>(integration: T, health: IntegrationHealthSnapshot | null = null) {
  return Object.freeze({
    id: integration.id,
    organizationId: integration.organizationId,
    providerCode: integration.providerCode,
    displayName: integration.displayName,
    status: integration.status,
    capabilities: Object.freeze([...integration.capabilities]),
    credentialVersion: integration.credentialVersion,
    createdAt: integration.createdAt,
    updatedAt: integration.updatedAt,
    archivedAt: integration.archivedAt,
    lastHealthStatus: health?.status ?? null,
    lastHealthCheckedAt: health?.checkedAt ?? null,
  });
}
