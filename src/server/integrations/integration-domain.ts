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

const capabilitySet = new Set<string>(integrationCapabilities);

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
}>(integration: T) {
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
  });
}
