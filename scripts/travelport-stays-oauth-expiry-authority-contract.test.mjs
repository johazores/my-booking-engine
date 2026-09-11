import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFileSync(new URL(path, root), 'utf8');

test('Travelport OAuth expiry authority is validated before the compatibility token parser', () => {
  const provider = source('src/server/suppliers/travelport-stays-provider.ts');
  assert.match(provider, /DOCUMENTED_ACCESS_TOKEN_LIFETIME_SECONDS = 86_400/);
  assert.match(provider, /CANONICAL_OAUTH_EXPIRY_PATTERN = \/\^\[1-9\]\\d\{0,4\}\$\//);
  assert.match(provider, /Number\.isSafeInteger\(value\)/);
  assert.match(provider, /value > DOCUMENTED_ACCESS_TOKEN_LIFETIME_SECONDS/);
  assert.match(provider, /String\(seconds\) !== value/);
  assert.match(provider, /validateOAuthExpiresInIfPresent\(object\.expires_in\)/);
  const tokenIndex = provider.indexOf("exactMachineToken(object.access_token, MAX_ACCESS_TOKEN_LENGTH, 'response')");
  const expiryIndex = provider.indexOf('validateOAuthExpiresInIfPresent(object.expires_in)');
  assert.ok(tokenIndex >= 0 && expiryIndex > tokenIndex);
});

test('focused OAuth expiry behavior coverage is included in the default supplier test glob', () => {
  const packageJson = JSON.parse(source('package.json'));
  assert.match(packageJson.scripts.test, /src\/server\/suppliers\/\*\.test\.ts/);
  const behavior = source('src/server/suppliers/travelport-stays-oauth-expiry-authority.test.ts');
  assert.match(behavior, /' 3600'/);
  assert.match(behavior, /'03600'/);
  assert.match(behavior, /'3\.6e3'/);
  assert.match(behavior, /86_401/);
  assert.match(behavior, /'86400'/);
});
