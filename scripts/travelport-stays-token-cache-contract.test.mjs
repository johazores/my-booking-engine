import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const sources = [
  "src/server/suppliers/travelport-stays-provider-core.ts",
  "src/server/suppliers/travelport-stays-booking-terms-provider-core.ts",
  "src/server/suppliers/travelport-stays-reservation-authority-provider-core.ts",
  "src/server/suppliers/travelport-stays-reservation-create-executor.ts",
  "src/server/suppliers/travelport-stays-reservation-sync-executor.ts",
  "src/server/suppliers/travelport-stays-reservation-recovery-provider.ts"
];

test('OAuth token deadlines preserve provider lifetime authority even for short tokens', () => {
  const core = readFileSync(join(process.cwd(), 'src/server/suppliers/travelport-stays-provider-core.ts'), 'utf8');
  assert.match(core, /const refreshSkewMs = Math\.min\(TOKEN_REFRESH_SKEW_MS, lifetimeMs \/ 2\)/);
  assert.match(core, /expiresAtMs: nowMs \+ lifetimeMs - refreshSkewMs/);
  assert.doesNotMatch(core, /Math\.max\(1_000, lifetimeMs - TOKEN_REFRESH_SKEW_MS\)/);
});

test('all Travelport OAuth adapter caches bound completed tokens and retain in-flight deduplication', () => {
  const helper = readFileSync(join(process.cwd(), 'src/server/suppliers/travelport-stays-access-token-cache.ts'), 'utf8');
  assert.match(helper, /MAX_TRAVELPORT_STAYS_CACHED_TOKENS = 256/);
  assert.match(helper, /cache\.delete\(cachedKey\)/);
  assert.match(helper, /cache\.keys\(\)\.next\(\)\.value/);
  for (const path of sources) {
    const code = readFileSync(join(process.cwd(), path), 'utf8');
    assert.match(code, /readTravelportStaysCachedToken\(/, path);
    assert.match(code, /storeTravelportStaysCachedToken\(/, path);
    assert.match(code, /if\s*\(!storeTravelportStaysCachedToken\(/, `${path}: expired-on-completion token must not be returned`);
    assert.match(code, /throw new HospitalitySupplierProviderError\('PROVIDER_UNAVAILABLE'\)/, `${path}: reject unusable OAuth responses safely`);
    assert.match(code, /storeTravelportStaysCachedToken\([^;]*?,\s*(?:this\.#now\(\)\.getTime\(\)|input\.now\(\))\)/, `${path}: completion clock must be fresh`);
    assert.doesNotMatch(code, /(?:tokenCache|rulesTokenCache)\.(?:get|set)\(/, path);
    assert.match(code, /(?:tokenRequests|rulesTokenRequests)\.get\(/, path);
    assert.match(code, /(?:tokenRequests|rulesTokenRequests)\.delete\(/, path);
  }
  for (const path of sources.slice(0, 2)) {
    const code = readFileSync(join(process.cwd(), path), 'utf8');
    assert.match(code, /now:\s*\(\)\s*=>\s*this\.#now\(\)\.getTime\(\)/, `${path}: injected clock must be preserved`);
  }
});
