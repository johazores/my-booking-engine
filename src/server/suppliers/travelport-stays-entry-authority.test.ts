import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import {
  materializeTravelportStaysAccessTokenAuthority,
  materializeTravelportStaysConfigurationAuthority,
  materializeTravelportStaysHealthProbeAuthority,
} from './travelport-stays-entry-authority.ts';
import { TravelportStaysConfigurationError } from './travelport-stays-provider-core.ts';

function trackedInput(values: Readonly<Record<string, unknown>>) {
  const reads = new Map<string, number>();
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
  return { input, reads };
}

function assertOneRead(reads: Map<string, number>, keys: readonly string[]) {
  for (const key of keys) assert.equal(reads.get(key), 1, `${key} should be read exactly once`);
}

test('configuration authority is one-read and remains stable after caller state changes', () => {
  const values: Record<string, unknown> = {
    environment: 'pre-production',
    username: 'user',
    password: 'password',
    clientId: 'client',
    clientSecret: 'secret',
    accessGroup: 'group',
  };
  const { input, reads } = trackedInput(values);
  const authority = materializeTravelportStaysConfigurationAuthority(input as never);

  assertOneRead(reads, ['environment', 'username', 'password', 'clientId', 'clientSecret', 'accessGroup']);
  assert.ok(Object.isFrozen(authority));
  values.username = 'mutated';
  values.clientSecret = 'mutated-secret';
  assert.equal(authority.username, 'user');
  assert.equal(authority.clientSecret, 'secret');
});

test('access-token authority freezes a credential snapshot and reads transport authority once', () => {
  const credentials = {
    environment: 'pre-production',
    username: 'user',
    password: 'password',
    clientId: 'client',
    clientSecret: 'secret',
    accessGroup: 'group',
  };
  const fetchImpl = (async () => new Response(null, { status: 204 })) as typeof fetch;
  const { input, reads } = trackedInput({ credentials, fetchImpl, timeoutMs: 15_000, nowMs: 123 });
  const authority = materializeTravelportStaysAccessTokenAuthority(input as never);

  assertOneRead(reads, ['credentials', 'fetchImpl', 'timeoutMs', 'nowMs']);
  assert.ok(Object.isFrozen(authority));
  assert.ok(Object.isFrozen(authority.credentials));
  assert.equal(authority.fetchImpl, fetchImpl);
  assert.equal(authority.nowMs, 123);
  credentials.username = 'mutated';
  assert.equal(authority.credentials.username, 'user');
});

test('entry authority sanitizes configuration accessors and provider proxies', () => {
  assert.throws(
    () => materializeTravelportStaysConfigurationAuthority({
      environment: 'pre-production',
      get username() {
        throw new Error('do not leak config getter text');
      },
      password: 'password',
      clientId: 'client',
      clientSecret: 'secret',
      accessGroup: 'group',
    }),
    (error: unknown) => error instanceof TravelportStaysConfigurationError
      && error.message === 'Travelport configuration authority could not be materialized safely.'
      && !error.message.includes('do not leak'),
  );

  const { proxy, revoke } = Proxy.revocable({
    credentials: {},
    timeoutMs: 15_000,
  }, {});
  revoke();
  assert.throws(
    () => materializeTravelportStaysHealthProbeAuthority(proxy as never),
    (error: unknown) => error instanceof HospitalitySupplierProviderError
      && error.code === 'INVALID_REQUEST'
      && error.message === 'Travelport provider entry authority could not be materialized safely.',
  );
});
