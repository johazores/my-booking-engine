import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decryptIntegrationCredentials,
  encryptIntegrationCredentials,
  normalizeIntegrationCredentials,
  readIntegrationMasterKey,
} from './integration-crypto.ts';

const TEST_KEY = Buffer.alloc(32, 7);
const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function changeEncodedByte(value: string) {
  return `${value.startsWith('A') ? 'B' : 'A'}${value.slice(1)}`;
}

function changeUnusedBase64Bits(value: string) {
  const last = value.at(-1) ?? '';
  const index = BASE64URL_ALPHABET.indexOf(last);
  assert.notEqual(index, -1);
  return `${value.slice(0, -1)}${BASE64URL_ALPHABET[index ^ 1]}`;
}

test('integration credentials encrypt and decrypt with authenticated encryption', () => {
  const encrypted = encryptIntegrationCredentials({ secretKey: 'sk_test_example', webhookSecret: 'whsec_example' }, TEST_KEY);
  assert.equal(encrypted.includes('sk_test_example'), false);
  assert.deepEqual(decryptIntegrationCredentials(encrypted, TEST_KEY), {
    secretKey: 'sk_test_example',
    webhookSecret: 'whsec_example',
  });
});

test('largest supported escaped credential set remains decryptable under the envelope size cap', () => {
  const credentials = Object.fromEntries(
    Array.from({ length: 20 }, (_, index) => [`key${index.toString().padStart(2, '0')}`, '\u0000'.repeat(4096)]),
  );
  const encrypted = encryptIntegrationCredentials(credentials, TEST_KEY);
  assert.ok(encrypted.length < 1_048_576);
  assert.deepEqual(decryptIntegrationCredentials(encrypted, TEST_KEY), credentials);
});

test('integration credential encryption rejects tampering and invalid shapes', () => {
  const encrypted = encryptIntegrationCredentials({ secretKey: 'sk_test_example' }, TEST_KEY);
  const parts = encrypted.split('.');
  for (const part of [1, 2, 3]) {
    const modified = [...parts];
    modified[part] = changeEncodedByte(parts[part]);
    assert.throws(() => decryptIntegrationCredentials(modified.join('.'), TEST_KEY), /could not be authenticated/);
  }
  assert.throws(() => decryptIntegrationCredentials(encrypted, Buffer.alloc(32, 8)), /could not be authenticated/);
  assert.throws(() => decryptIntegrationCredentials(`v2.${parts.slice(1).join('.')}`, TEST_KEY), /unsupported envelope/);
  assert.throws(() => decryptIntegrationCredentials(`${encrypted}.extra`, TEST_KEY), /unsupported envelope/);
  assert.throws(() => normalizeIntegrationCredentials({}), /between 1 and 20/);
  assert.throws(() => normalizeIntegrationCredentials({ SecretKey: 'x' }), /keys are invalid/);
  assert.throws(() => normalizeIntegrationCredentials({ secretKey: '' }), /is invalid/);
});

test('integration credential envelopes reject noncanonical base64url encodings', () => {
  const encrypted = encryptIntegrationCredentials({ secretKey: 'sk_test_example' }, TEST_KEY);
  const parts = encrypted.split('.');
  const alteredTag = [...parts];
  alteredTag[2] = changeUnusedBase64Bits(parts[2]);
  assert.deepEqual(Buffer.from(alteredTag[2], 'base64url'), Buffer.from(parts[2], 'base64url'));
  assert.throws(() => decryptIntegrationCredentials(alteredTag.join('.'), TEST_KEY), /malformed/);
  assert.throws(() => decryptIntegrationCredentials('x'.repeat(1_048_577), TEST_KEY), /malformed/);
  assert.throws(() => decryptIntegrationCredentials(null as unknown as string, TEST_KEY), /unsupported envelope/);

  for (const part of [1, 2, 3]) {
    const padded = [...parts];
    padded[part] += '=';
    assert.throws(() => decryptIntegrationCredentials(padded.join('.'), TEST_KEY), /malformed/);
    const junk = [...parts];
    junk[part] += '!';
    assert.throws(() => decryptIntegrationCredentials(junk.join('.'), TEST_KEY), /malformed/);
  }
});

test('duplicate credential keys are rejected', () => {
  assert.throws(() => normalizeIntegrationCredentials({ alpha: 'one', ' alpha ': 'two' }), /unique after normalization/);
});

test('integration master key requires an exact base64url 32-byte deployment secret', () => {
  const encoded = TEST_KEY.toString('base64url');
  assert.equal(readIntegrationMasterKey(encoded).equals(TEST_KEY), true);
  assert.throws(() => readIntegrationMasterKey('not-a-valid-key'), /32-byte key/);
  const alias = changeUnusedBase64Bits(encoded);
  assert.deepEqual(Buffer.from(alias, 'base64url'), TEST_KEY);
  assert.throws(() => readIntegrationMasterKey(alias), /canonical/);
});
