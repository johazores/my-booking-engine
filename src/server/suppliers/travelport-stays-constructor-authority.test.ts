import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import {
  materializeTravelportStaysBookingTermsConstructorAuthority,
  materializeTravelportStaysReservationAuthorityConstructorAuthority,
} from './travelport-stays-constructor-authority.ts';

function trackedConstructorInput(dependencyKey: 'pricingProvider' | 'bookingTermsProvider') {
  const reads = new Map<string, number>();
  const credentials = {
    environment: 'pre-production',
    username: 'user',
    password: 'password',
    clientId: 'client',
    clientSecret: 'secret',
    accessGroup: 'group',
  };
  const dependency = Object.freeze({ code: 'dependency' });
  const fetchImpl = (async () => new Response(null, { status: 204 })) as typeof fetch;
  const now = () => new Date('2026-09-12T00:00:00.000Z');
  const values: Record<string, unknown> = {
    credentials,
    cacheKey: 'tenant-a:v1',
    [dependencyKey]: dependency,
    fetchImpl,
    timeoutMs: 15_000,
    now,
  };
  const input = {} as Record<string, unknown>;
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(input, key, {
      enumerable: true,
      get() {
        reads.set(key, (reads.get(key) ?? 0) + 1);
        return value;
      },
    });
  }
  return { input, reads, credentials, dependency, fetchImpl, now };
}

function assertOneRead(reads: Map<string, number>, keys: readonly string[]) {
  for (const key of keys) assert.equal(reads.get(key), 1, `${key} should be read exactly once`);
}

test('booking terms constructor authority is one-read and isolates credential mutation', () => {
  const { input, reads, credentials, dependency, fetchImpl, now } = trackedConstructorInput('pricingProvider');
  const authority = materializeTravelportStaysBookingTermsConstructorAuthority(input as never);

  assertOneRead(reads, ['credentials', 'cacheKey', 'pricingProvider', 'fetchImpl', 'timeoutMs', 'now']);
  assert.ok(Object.isFrozen(authority));
  assert.ok(Object.isFrozen(authority.credentials));
  assert.equal(authority.pricingProvider, dependency);
  assert.equal(authority.fetchImpl, fetchImpl);
  assert.equal(authority.now, now);
  assert.equal(authority.cacheKey, 'tenant-a:v1');

  credentials.username = 'mutated-user';
  credentials.clientSecret = 'mutated-secret';
  assert.equal(authority.credentials.username, 'user');
  assert.equal(authority.credentials.clientSecret, 'secret');
});

test('reservation authority constructor materializes the exact dependency and cache key forwarded to the core', () => {
  const { input, reads, dependency } = trackedConstructorInput('bookingTermsProvider');
  const authority = materializeTravelportStaysReservationAuthorityConstructorAuthority(input as never);

  assertOneRead(reads, ['credentials', 'cacheKey', 'bookingTermsProvider', 'fetchImpl', 'timeoutMs', 'now']);
  assert.ok(Object.isFrozen(authority));
  assert.ok(Object.isFrozen(authority.credentials));
  assert.equal(authority.bookingTermsProvider, dependency);
  assert.equal(authority.cacheKey, 'tenant-a:v1');
});

test('constructor materialization sanitizes hostile accessors and revoked proxies', () => {
  assert.throws(
    () => materializeTravelportStaysBookingTermsConstructorAuthority({
      get credentials() {
        throw new Error('do not leak this caller text');
      },
      cacheKey: 'tenant-a:v1',
      pricingProvider: {} as never,
    } as never),
    (error: unknown) => error instanceof HospitalitySupplierProviderError
      && error.code === 'INVALID_REQUEST'
      && error.message === 'Travelport provider constructor authority could not be materialized safely.'
      && !error.message.includes('do not leak'),
  );

  const { proxy, revoke } = Proxy.revocable({
    credentials: {},
    cacheKey: 'tenant-a:v1',
    bookingTermsProvider: {},
  }, {});
  revoke();
  assert.throws(
    () => materializeTravelportStaysReservationAuthorityConstructorAuthority(proxy as never),
    (error: unknown) => error instanceof HospitalitySupplierProviderError
      && error.code === 'INVALID_REQUEST'
      && error.message === 'Travelport provider constructor authority could not be materialized safely.',
  );
});
