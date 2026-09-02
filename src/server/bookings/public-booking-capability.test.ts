import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PublicBookingCapabilityConfigurationError,
  issuePublicBookingHoldCapability,
  verifyPublicBookingHoldCapability,
} from './public-booking-capability.ts';
import {
  derivePublicBookingHoldIdempotencyKey,
  normalizePublicBookingRequestKey,
  PublicBookingRequestValidationError,
} from './public-booking-request-domain.ts';

const secret = '0123456789abcdef0123456789abcdef';
const organizationId = '11111111-1111-4111-8111-111111111111';
const holdId = '22222222-2222-4222-8222-222222222222';
const now = new Date('2026-09-02T00:00:00.000Z');
const expiresAt = new Date('2026-09-02T00:15:00.000Z');

test('hold capability verifies only for the encrypted tenant before expiry', () => {
  const token = issuePublicBookingHoldCapability({ secret, organizationId, holdId, expiresAt });
  const verified = verifyPublicBookingHoldCapability({ secret, token, expectedOrganizationId: organizationId, now });

  assert.deepEqual(verified, {
    version: 1,
    scope: 'hold:manage',
    organizationId,
    holdId,
    expiresAt,
  });
  assert.equal(token.includes(organizationId), false);
  assert.equal(token.includes(holdId), false);
  assert.equal(verifyPublicBookingHoldCapability({ secret, token, expectedOrganizationId: '33333333-3333-4333-8333-333333333333', now }), null);
  assert.equal(verifyPublicBookingHoldCapability({ secret, token, expectedOrganizationId: organizationId, now: expiresAt }), null);
});

test('hold capability rejects ciphertext, tag, and malformed-token tampering', () => {
  const token = issuePublicBookingHoldCapability({ secret, organizationId, holdId, expiresAt });
  const [version, iv, ciphertext, tag] = token.split('.');

  assert.equal(verifyPublicBookingHoldCapability({ secret, token: `${version}.${iv}.${ciphertext}x.${tag}`, now }), null);
  assert.equal(verifyPublicBookingHoldCapability({ secret, token: `${version}.${iv}.${ciphertext}.${tag}x`, now }), null);
  assert.equal(verifyPublicBookingHoldCapability({ secret, token: 'not-a-token', now }), null);
});

test('capability secret fails closed when production key material is too weak', () => {
  assert.throws(
    () => issuePublicBookingHoldCapability({ secret: 'short', organizationId, holdId, expiresAt }),
    PublicBookingCapabilityConfigurationError,
  );
});

test('public request keys normalize UUID v4 and derive tenant-bound opaque idempotency keys', () => {
  const requestKey = normalizePublicBookingRequestKey('AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA');
  assert.equal(requestKey, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

  const first = derivePublicBookingHoldIdempotencyKey({ secret, organizationId, requestKey });
  const repeated = derivePublicBookingHoldIdempotencyKey({ secret, organizationId, requestKey });
  const otherTenant = derivePublicBookingHoldIdempotencyKey({
    secret,
    organizationId: '33333333-3333-4333-8333-333333333333',
    requestKey,
  });

  assert.match(first, /^public:[0-9a-f]{64}$/);
  assert.equal(first, repeated);
  assert.notEqual(first, otherTenant);
  assert.throws(() => normalizePublicBookingRequestKey('predictable-request-key'), PublicBookingRequestValidationError);
});
