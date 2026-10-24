/**
 * In-process OAuth cache hygiene for Travelport adapters. Each adapter owns its
 * credential-version-keyed map; only completed tokens live here. In-flight
 * refresh promises remain separately deduplicated and are never evicted.
 */
export type TravelportStaysCachedAccessToken = Readonly<{
  accessToken: string;
  expiresAtMs: number;
}>;

export const MAX_TRAVELPORT_STAYS_CACHED_TOKENS = 256;

type ExpiringToken = Readonly<{ expiresAtMs: number }>;

export function readTravelportStaysCachedToken<T extends ExpiringToken>(
  cache: Map<string, T>,
  key: string,
  nowMs: number,
): T | null {
  const cached = cache.get(key);
  if (!cached) return null;
  if (!(cached.expiresAtMs > nowMs)) {
    cache.delete(key);
    return null;
  }
  // Keep recently used live keys when old credential versions are evicted.
  cache.delete(key);
  cache.set(key, cached);
  return cached;
}

export function storeTravelportStaysCachedToken<T extends ExpiringToken>(
  cache: Map<string, T>,
  key: string,
  token: T,
  nowMs: number,
): void {
  // Rotation and tenant churn must not retain expired bearer tokens forever.
  for (const [cachedKey, cached] of cache) {
    if (!(cached.expiresAtMs > nowMs)) cache.delete(cachedKey);
  }
  cache.delete(key);
  if (!(token.expiresAtMs > nowMs)) return;
  cache.set(key, token);
  while (cache.size > MAX_TRAVELPORT_STAYS_CACHED_TOKENS) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}
