import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_TRAVELPORT_STAYS_CACHED_TOKENS,
  readTravelportStaysCachedToken,
  storeTravelportStaysCachedToken,
} from './travelport-stays-access-token-cache.ts';

type Token = Readonly<{ accessToken: string; expiresAtMs: number }>;
const token = (value: string, expiresAtMs = 10_000): Token => ({ accessToken: value, expiresAtMs });

test('live tokens are reused and expired tokens are deleted on read', () => {
  const cache = new Map<string, Token>();
  storeTravelportStaysCachedToken(cache, 'tenant-v1', token('bearer'), 100);
  assert.equal(readTravelportStaysCachedToken(cache, 'tenant-v1', 999)?.accessToken, 'bearer');
  assert.equal(readTravelportStaysCachedToken(cache, 'tenant-v1', 10_000), null);
  assert.equal(cache.size, 0);
});

test('expired entries are pruned on write without evicting valid tokens', () => {
  const cache = new Map<string, Token>();
  storeTravelportStaysCachedToken(cache, 'old-version', token('old', 200), 100);
  storeTravelportStaysCachedToken(cache, 'new-version', token('new'), 201);
  assert.equal(cache.has('old-version'), false);
  assert.equal(readTravelportStaysCachedToken(cache, 'new-version', 201)?.accessToken, 'new');
});

test('cache is bounded and evicts the least recently used completed token', () => {
  const cache = new Map<string, Token>();
  for (let i = 0; i < MAX_TRAVELPORT_STAYS_CACHED_TOKENS; i += 1) {
    storeTravelportStaysCachedToken(cache, `tenant-${i}`, token(`secret-${i}`), 100);
  }
  assert.equal(cache.size, MAX_TRAVELPORT_STAYS_CACHED_TOKENS);
  assert.equal(readTravelportStaysCachedToken(cache, 'tenant-0', 100)?.accessToken, 'secret-0');
  storeTravelportStaysCachedToken(cache, 'tenant-new', token('new'), 100);
  assert.equal(cache.size, MAX_TRAVELPORT_STAYS_CACHED_TOKENS);
  assert.equal(cache.has('tenant-0'), true);
  assert.equal(cache.has('tenant-1'), false);
  assert.equal(cache.has('tenant-new'), true);
});

test('rotating a key replaces its bearer and does not grow the cache', () => {
  const cache = new Map<string, Token>();
  storeTravelportStaysCachedToken(cache, 'tenant-v2', token('first'), 100);
  storeTravelportStaysCachedToken(cache, 'tenant-v2', token('second'), 100);
  assert.equal(cache.size, 1);
  assert.equal(readTravelportStaysCachedToken(cache, 'tenant-v2', 100)?.accessToken, 'second');
});

test('already expired and non-finite expiry values are never retained', () => {
  const cache = new Map<string, Token>();
  storeTravelportStaysCachedToken(cache, 'expired', token('bad', 100), 100);
  storeTravelportStaysCachedToken(cache, 'nan', token('bad', Number.NaN), 100);
  assert.equal(cache.size, 0);
});
