import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeIntegrationCapabilities,
  normalizeIntegrationDisplayName,
  normalizeIntegrationProviderCode,
  publicIntegrationRecord,
} from './integration-domain.ts';

test('integration provider metadata is normalized deterministically', () => {
  assert.equal(normalizeIntegrationProviderCode(' Stripe '), 'stripe');
  assert.equal(normalizeIntegrationDisplayName('  Stripe   Payments  '), 'Stripe Payments');
  assert.deepEqual(normalizeIntegrationCapabilities(['webhooks', 'payment-refund', 'webhooks']), ['payment-refund', 'webhooks']);
});

test('integration metadata rejects unknown capabilities and unsafe provider codes', () => {
  assert.throws(() => normalizeIntegrationProviderCode('../stripe'), /invalid/);
  assert.throws(() => normalizeIntegrationCapabilities(['magic-capability']), /Unsupported integration capability/);
});

test('public integration records expose safe lifecycle metadata without credential material', () => {
  const archivedAt = new Date('2026-09-02T00:00:00Z');
  const record = publicIntegrationRecord({
    id: '11111111-1111-4111-8111-111111111111',
    organizationId: '22222222-2222-4222-8222-222222222222',
    providerCode: 'stripe',
    displayName: 'Stripe',
    status: 'ARCHIVED',
    capabilities: ['payment-authorize'],
    credentialVersion: 2,
    encryptedCredentials: 'must-not-leak',
    archivedAt,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: archivedAt,
  });
  assert.equal('encryptedCredentials' in record, false);
  assert.equal(record.credentialVersion, 2);
  assert.equal(record.archivedAt, archivedAt);
});
