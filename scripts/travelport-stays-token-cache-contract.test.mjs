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

test('all Travelport OAuth adapter caches bound completed tokens and retain in-flight deduplication', () => {
  const helper = readFileSync(join(process.cwd(), 'src/server/suppliers/travelport-stays-access-token-cache.ts'), 'utf8');
  assert.match(helper, /MAX_TRAVELPORT_STAYS_CACHED_TOKENS = 256/);
  assert.match(helper, /cache\.delete\(cachedKey\)/);
  assert.match(helper, /cache\.keys\(\)\.next\(\)\.value/);
  for (const path of sources) {
    const code = readFileSync(join(process.cwd(), path), 'utf8');
    assert.match(code, /readTravelportStaysCachedToken\(/, path);
    assert.match(code, /storeTravelportStaysCachedToken\(/, path);
    assert.match(code, /storeTravelportStaysCachedToken\([^;]*?,\s*(?:this\.#now\(\)\.getTime\(\)|input\.now\(\)|Date\.now\(\))\)/, `${path}: completion clock must be fresh`);
    assert.doesNotMatch(code, /(?:tokenCache|rulesTokenCache)\.(?:get|set)\(/, path);
    assert.match(code, /(?:tokenRequests|rulesTokenRequests)\.get\(/, path);
    assert.match(code, /(?:tokenRequests|rulesTokenRequests)\.delete\(/, path);
  }
  const rules = readFileSync(join(process.cwd(), sources[1]), 'utf8');
  assert.match(rules, /now:\s*\(\)\s*=>\s*this\.#now\(\)\.getTime\(\)/);
});
