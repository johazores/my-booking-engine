import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { materializeTravelportStaysReservationIoConstructorAuthority } from './travelport-stays-constructor-authority.ts';

function trackedInput() {
  const reads = new Map<string, number>();
  const credentials = {
    environment: 'pre-production',
    username: 'user',
    password: 'password',
    clientId: 'client',
    clientSecret: 'secret',
    accessGroup: 'group',
  };
  const fetchImpl = (async () => new Response(null, { status: 204 })) as typeof fetch;
  const now = () => new Date('2026-09-12T10:00:00.000Z');
  const values: Record<string, unknown> = {
    credentials,
    cacheKey: 'tenant-a:v1',
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
  return { input, reads, credentials, fetchImpl, now };
}

test('reservation I/O constructor authority is one-read and isolates credential mutation', () => {
  const { input, reads, credentials, fetchImpl, now } = trackedInput();
  const authority = materializeTravelportStaysReservationIoConstructorAuthority(input as never);

  for (const key of ['credentials', 'cacheKey', 'fetchImpl', 'timeoutMs', 'now']) {
    assert.equal(reads.get(key), 1, `${key} should be read exactly once`);
  }
  assert.ok(Object.isFrozen(authority));
  assert.ok(Object.isFrozen(authority.credentials));
  assert.equal(authority.cacheKey, 'tenant-a:v1');
  assert.equal(authority.fetchImpl, fetchImpl);
  assert.equal(authority.now, now);

  credentials.username = 'mutated-user';
  credentials.clientSecret = 'mutated-secret';
  assert.equal(authority.credentials.username, 'user');
  assert.equal(authority.credentials.clientSecret, 'secret');
});

test('reservation I/O constructor authority sanitizes hostile caller objects', () => {
  assert.throws(
    () => materializeTravelportStaysReservationIoConstructorAuthority({
      get credentials() {
        throw new Error('do not leak this reservation constructor text');
      },
      cacheKey: 'tenant-a:v1',
    } as never),
    (error: unknown) => error instanceof HospitalitySupplierProviderError
      && error.code === 'INVALID_REQUEST'
      && error.message === 'Travelport provider constructor authority could not be materialized safely.'
      && !error.message.includes('do not leak'),
  );

  const { proxy, revoke } = Proxy.revocable({
    credentials: {},
    cacheKey: 'tenant-a:v1',
  }, {});
  revoke();
  assert.throws(
    () => materializeTravelportStaysReservationIoConstructorAuthority(proxy as never),
    (error: unknown) => error instanceof HospitalitySupplierProviderError
      && error.code === 'INVALID_REQUEST'
      && error.message === 'Travelport provider constructor authority could not be materialized safely.',
  );
});
