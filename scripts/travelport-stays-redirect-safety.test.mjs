import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFileSync(new URL(path, root), 'utf8');

const sharedFetchFiles = [
  'src/server/suppliers/travelport-stays-provider.ts',
  'src/server/suppliers/travelport-stays-booking-terms-provider.ts',
  'src/server/suppliers/travelport-stays-reservation-recovery-provider.ts',
];

test('Travelport shared fetch boundaries override caller redirect mode and fail closed before following redirects', () => {
  for (const path of sharedFetchFiles) {
    const value = source(path);
    assert.match(
      value,
      /fetchImpl\(input\.url, \{ \.\.\.input\.init, redirect: 'manual', signal: controller\.signal \}\)/,
      `${path} must apply redirect: manual after spreading request init`,
    );
    assert.doesNotMatch(
      value,
      /fetchImpl\(input\.url, \{ \.\.\.input\.init, signal: controller\.signal \}\)/,
      `${path} must not keep the redirect-following fetch shape`,
    );
  }
});

test('Travelport selected-offer authority disables redirect following on its direct fetch boundary', () => {
  const value = source('src/server/suppliers/travelport-stays-reservation-authority-provider.ts');
  assert.match(value, /cache: 'no-store',\n\s+redirect: 'manual',\n\s+signal: controller\.signal,/);
});

test('Travelport integration documentation records the fixed-endpoint no-redirect transport contract', () => {
  const integration = source('docs/travelport-stays-integration.md');
  const gds = source('docs/gds-integration.md');
  for (const value of [integration, gds]) {
    assert.match(value, /redirect: 'manual'/);
    assert.match(value, /3xx/);
    assert.match(value, /fixed/i);
  }
});
