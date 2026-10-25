import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_TRAVELPORT_STAYS_CACHED_TOKENS,
  invalidateTravelportStaysCachedToken,
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

test('a token that expires during a slow OAuth exchange is not retained after completion', () => {
  const cache = new Map<string, Token>();
  const requestStartedAt = 100;
  const tokenExpiresAt = 150;
  const requestCompletedAt = 151;
  assert.ok(tokenExpiresAt > requestStartedAt);
  storeTravelportStaysCachedToken(cache, 'slow-tenant', token('expired-before-response', tokenExpiresAt), requestCompletedAt);
  assert.equal(cache.size, 0);
  storeTravelportStaysCachedToken(cache, 'healthy-tenant', token('fresh', 300), requestCompletedAt);
  assert.equal(readTravelportStaysCachedToken(cache, 'healthy-tenant', requestCompletedAt)?.accessToken, 'fresh');
});

test('cache retention reports whether the OAuth response is still usable at completion', () => {
  const cache = new Map<string, Token>();
  assert.equal(storeTravelportStaysCachedToken(cache, 'slow-tenant', token('expired', 150), 151), false);
  assert.equal(readTravelportStaysCachedToken(cache, 'slow-tenant', 151), null);
  assert.equal(storeTravelportStaysCachedToken(cache, 'slow-tenant', token('fresh', 500), 151), true);
  assert.equal(readTravelportStaysCachedToken(cache, 'slow-tenant', 151)?.accessToken, 'fresh');
});

test('stale 401 cannot evict a newer bearer for the same tenant key', () => {
  const cache = new Map<string, Token>();
  storeTravelportStaysCachedToken(cache, 'tenant:v1', token('old'), 100);
  const sent = readTravelportStaysCachedToken(cache, 'tenant:v1', 100)?.accessToken;
  storeTravelportStaysCachedToken(cache, 'tenant:v1', token('new'), 101);
  assert.equal(invalidateTravelportStaysCachedToken(cache, 'tenant:v1', sent!), false);
  assert.equal(readTravelportStaysCachedToken(cache, 'tenant:v1', 102)?.accessToken, 'new');
});

test('current bearer rejection evicts only its tenant credential version', () => {
  const cache = new Map<string, Token>();
  storeTravelportStaysCachedToken(cache, 'a:v1', token('rejected'), 100);
  storeTravelportStaysCachedToken(cache, 'b:v1', token('other'), 100);
  assert.equal(invalidateTravelportStaysCachedToken(cache, 'a:v1', 'unrelated'), false);
  assert.equal(invalidateTravelportStaysCachedToken(cache, 'missing', 'rejected'), false);
  assert.equal(invalidateTravelportStaysCachedToken(cache, 'a:v1', 'rejected'), true);
  assert.equal(readTravelportStaysCachedToken(cache, 'a:v1', 100), null);
  assert.equal(readTravelportStaysCachedToken(cache, 'b:v1', 100)?.accessToken, 'other');
});
