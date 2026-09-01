import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decryptIntegrationCredentials,
  encryptIntegrationCredentials,
  normalizeIntegrationCredentials,
  readIntegrationMasterKey,
} from './integration-crypto.ts';

const TEST_KEY = Buffer.alloc(32, 7);

test('integration credentials encrypt and decrypt with authenticated encryption', () => {
  const encrypted = encryptIntegrationCredentials({ secretKey: 'sk_test_example', webhookSecret: 'whsec_example' }, TEST_KEY);
  assert.equal(encrypted.includes('sk_test_example'), false);
  assert.deepEqual(decryptIntegrationCredentials(encrypted, TEST_KEY), {
    secretKey: 'sk_test_example',
    webhookSecret: 'whsec_example',
  });
});

test('integration credential encryption rejects tampering and invalid shapes', () => {
  const encrypted = encryptIntegrationCredentials({ secretKey: 'sk_test_example' }, TEST_KEY);
  const parts = encrypted.split('.');
  parts[3] = `${parts[3].slice(0, -1)}${parts[3].endsWith('A') ? 'B' : 'A'}`;
  assert.throws(() => decryptIntegrationCredentials(parts.join('.'), TEST_KEY), /could not be authenticated/);
  assert.throws(() => normalizeIntegrationCredentials({}), /between 1 and 20/);
  assert.throws(() => normalizeIntegrationCredentials({ SecretKey: 'x' }), /keys are invalid/);
  assert.throws(() => normalizeIntegrationCredentials({ secretKey: '' }), /is invalid/);
});

test('integration master key requires an exact base64url 32-byte deployment secret', () => {
  const encoded = TEST_KEY.toString('base64url');
  assert.equal(readIntegrationMasterKey(encoded).equals(TEST_KEY), true);
  assert.throws(() => readIntegrationMasterKey('not-a-valid-key'), /32-byte key/);
});
