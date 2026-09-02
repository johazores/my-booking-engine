import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeIntegrationCapabilities,
  normalizeIntegrationDisplayName,
  normalizeIntegrationProviderCode,
  publicIntegrationRecord,
  readCurrentIntegrationHealth,
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

test('connection health only applies to the current non-archived credential version', () => {
  const checkedAt = new Date('2026-09-02T00:20:00Z');
  const current = readCurrentIntegrationHealth({
    integrationStatus: 'ACTIVE',
    credentialVersion: 3,
    event: { createdAt: checkedAt, afterData: { result: 'HEALTHY', credentialVersion: 3 } },
  });
  assert.equal(current?.status, 'HEALTHY');
  assert.equal(current?.checkedAt, checkedAt);

  assert.equal(readCurrentIntegrationHealth({
    integrationStatus: 'ACTIVE',
    credentialVersion: 4,
    event: { createdAt: checkedAt, afterData: { result: 'HEALTHY', credentialVersion: 3 } },
  }), null);
  assert.equal(readCurrentIntegrationHealth({
    integrationStatus: 'ARCHIVED',
    credentialVersion: 3,
    event: { createdAt: checkedAt, afterData: { result: 'HEALTHY', credentialVersion: 3 } },
  }), null);
  assert.equal(readCurrentIntegrationHealth({
    integrationStatus: 'ACTIVE',
    credentialVersion: 3,
    event: { createdAt: checkedAt, afterData: { result: 'NOT_REAL', credentialVersion: 3 } },
  }), null);
});

test('public integration records expose safe lifecycle and health metadata without credential material', () => {
  const checkedAt = new Date('2026-09-02T00:00:00Z');
  const record = publicIntegrationRecord({
    id: '11111111-1111-4111-8111-111111111111',
    organizationId: '22222222-2222-4222-8222-222222222222',
    providerCode: 'stripe',
    displayName: 'Stripe',
    status: 'ACTIVE',
    capabilities: ['payment-authorize'],
    credentialVersion: 2,
    encryptedCredentials: 'must-not-leak',
    archivedAt: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: checkedAt,
  }, { status: 'HEALTHY', checkedAt });
  assert.equal('encryptedCredentials' in record, false);
  assert.equal(record.credentialVersion, 2);
  assert.equal(record.archivedAt, null);
  assert.equal(record.lastHealthStatus, 'HEALTHY');
  assert.equal(record.lastHealthCheckedAt, checkedAt);
});
