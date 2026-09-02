import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PublicBookingCapabilityConfigurationError,
  issuePublicBookingBookingCapability,
  issuePublicBookingHoldCapability,
  verifyPublicBookingBookingCapability,
  verifyPublicBookingHoldCapability,
} from './public-booking-capability.ts';
import {
  createPublicBookingRequestFingerprint,
  derivePublicBookingConfirmationIdempotencyKey,
  derivePublicBookingHoldIdempotencyKey,
  normalizePublicBookingRequestKey,
  PublicBookingRequestValidationError,
} from './public-booking-request-domain.ts';

const secret = '0123456789abcdef0123456789abcdef';
const organizationId = '11111111-1111-4111-8111-111111111111';
const principalId = '44444444-4444-4444-8444-444444444444';
const holdId = '22222222-2222-4222-8222-222222222222';
const bookingId = '66666666-6666-4666-8666-666666666666';
const now = new Date('2026-09-02T00:00:00.000Z');
const expiresAt = new Date('2026-09-02T00:15:00.000Z');

test('hold capability verifies only for the encrypted tenant and principal before expiry', () => {
  const token = issuePublicBookingHoldCapability({ secret, organizationId, principalId, holdId, expiresAt });
  const verified = verifyPublicBookingHoldCapability({ secret, token, expectedOrganizationId: organizationId, expectedPrincipalId: principalId, now });
  assert.deepEqual(verified, { version: 2, scope: 'hold:manage', organizationId, principalId, holdId, expiresAt });
  assert.equal(token.includes(organizationId), false);
  assert.equal(token.includes(principalId), false);
  assert.equal(token.includes(holdId), false);
  assert.equal(verifyPublicBookingHoldCapability({ secret, token, expectedOrganizationId: '33333333-3333-4333-8333-333333333333', now }), null);
  assert.equal(verifyPublicBookingHoldCapability({ secret, token, expectedPrincipalId: '55555555-5555-4555-8555-555555555555', now }), null);
  assert.equal(verifyPublicBookingHoldCapability({ secret, token, expectedOrganizationId: organizationId, now: expiresAt }), null);
});

test('booking capability is scope-separated from hold capability and hides booking identity', () => {
  const bookingExpiresAt = new Date('2026-09-03T00:00:00.000Z');
  const token = issuePublicBookingBookingCapability({ secret, organizationId, principalId, bookingId, expiresAt: bookingExpiresAt });
  assert.deepEqual(
    verifyPublicBookingBookingCapability({ secret, token, expectedOrganizationId: organizationId, expectedPrincipalId: principalId, now }),
    { version: 3, scope: 'booking:manage', organizationId, principalId, bookingId, expiresAt: bookingExpiresAt },
  );
  assert.equal(token.includes(bookingId), false);
  assert.equal(verifyPublicBookingHoldCapability({ secret, token, expectedOrganizationId: organizationId, now }), null);
  const holdToken = issuePublicBookingHoldCapability({ secret, organizationId, principalId, holdId, expiresAt });
  assert.equal(verifyPublicBookingBookingCapability({ secret, token: holdToken, expectedOrganizationId: organizationId, now }), null);
});

test('hold capability rejects ciphertext, tag, legacy-version, and malformed-token tampering', () => {
  const token = issuePublicBookingHoldCapability({ secret, organizationId, principalId, holdId, expiresAt });
  const [version, iv, ciphertext, tag] = token.split('.');
  assert.equal(verifyPublicBookingHoldCapability({ secret, token: `${version}.${iv}.${ciphertext}x.${tag}`, now }), null);
  assert.equal(verifyPublicBookingHoldCapability({ secret, token: `${version}.${iv}.${ciphertext}.${tag}x`, now }), null);
  assert.equal(verifyPublicBookingHoldCapability({ secret, token: `v1.${iv}.${ciphertext}.${tag}`, now }), null);
  assert.equal(verifyPublicBookingHoldCapability({ secret, token: 'not-a-token', now }), null);
});

test('capability secret fails closed when production key material is too weak', () => {
  assert.throws(() => issuePublicBookingHoldCapability({ secret: 'short', organizationId, principalId, holdId, expiresAt }), PublicBookingCapabilityConfigurationError);
});

test('public request keys derive scope-separated tenant-bound idempotency keys', () => {
  const requestKey = normalizePublicBookingRequestKey('AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA');
  assert.equal(requestKey, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  const holdKey = derivePublicBookingHoldIdempotencyKey({ secret, organizationId, requestKey });
  const confirmationKey = derivePublicBookingConfirmationIdempotencyKey({ secret, organizationId, requestKey });
  const otherTenant = derivePublicBookingHoldIdempotencyKey({ secret, organizationId: '33333333-3333-4333-8333-333333333333', requestKey });
  assert.match(holdKey, /^public:[0-9a-f]{64}$/);
  assert.match(confirmationKey, /^public:[0-9a-f]{64}$/);
  assert.notEqual(holdKey, confirmationKey);
  assert.notEqual(holdKey, otherTenant);
  assert.throws(() => normalizePublicBookingRequestKey('predictable-request-key'), PublicBookingRequestValidationError);
});

test('public request fingerprints are deterministic across object key ordering and sensitive to payload changes', () => {
  const first = createPublicBookingRequestFingerprint({ customer: { email: 'guest@example.com', firstName: 'A' }, guests: [{ firstName: 'A' }] });
  const reordered = createPublicBookingRequestFingerprint({ guests: [{ firstName: 'A' }], customer: { firstName: 'A', email: 'guest@example.com' } });
  const changed = createPublicBookingRequestFingerprint({ customer: { email: 'guest@example.com', firstName: 'B' }, guests: [{ firstName: 'A' }] });
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(first, reordered);
  assert.notEqual(first, changed);
});
