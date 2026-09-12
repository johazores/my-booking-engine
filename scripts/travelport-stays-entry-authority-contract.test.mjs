import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('public Travelport configuration validates the exact materialized snapshot forwarded to core', async () => {
  const provider = await source('src/server/suppliers/travelport-stays-provider.ts');
  assert.match(provider, /const authority = materializeTravelportStaysConfigurationAuthority\(input\)/);
  for (const field of ['username', 'password', 'clientId', 'clientSecret', 'accessGroup']) {
    assert.match(provider, new RegExp(`exactConfigurationValue\\(authority\\.${field}`));
  }
  assert.match(provider, /normalizeTravelportStaysConfigurationCore\(authority\)/);
  assert.match(provider, /materializeTravelportStaysConfigurationAuthority\(credentials\)/);
});

test('access-token and health entries forward explicit materialized authority without spreading caller input', async () => {
  const provider = await source('src/server/suppliers/travelport-stays-provider.ts');
  assert.match(provider, /materializeTravelportStaysAccessTokenAuthority\(input\)/);
  assert.match(provider, /materializeTravelportStaysHealthProbeAuthority\(input\)/);
  assert.match(provider, /credentials: authority\.credentials/);
  assert.match(provider, /timeoutMs: authority\.timeoutMs/);
  assert.doesNotMatch(provider, /requestTravelportStaysAccessTokenCore\(\{\s*\.\.\.input/s);
  assert.doesNotMatch(provider, /probeTravelportStaysIntegrationHealthCore\(\{\s*\.\.\.input/s);
});

test('entry materializer freezes allowlisted credential authority and sanitizes hostile caller failures', async () => {
  const authority = await source('src/server/suppliers/travelport-stays-entry-authority.ts');
  const docs = await source('docs/travelport-stays-entry-authority.md');

  assert.match(authority, /materializeTravelportStaysConfigurationAuthority/);
  assert.match(authority, /materializeTravelportStaysAccessTokenAuthority/);
  assert.match(authority, /materializeTravelportStaysHealthProbeAuthority/);
  assert.match(authority, /credentials: credentialsSnapshot\(input\.credentials\)/);
  assert.match(authority, /Travelport configuration authority could not be materialized safely/);
  assert.match(authority, /Travelport provider entry authority could not be materialized safely/);
  assert.match(docs, /original input is never spread/i);
  assert.match(docs, /does not enable Travelport reservation capability/i);
});
