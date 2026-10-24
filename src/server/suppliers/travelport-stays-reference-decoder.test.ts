import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { decodeCanonicalTravelportStaysReference } from './travelport-stays-reference-decoder.ts';

const encode = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
const encodeRaw = (value: string) => Buffer.from(value, 'utf8').toString('base64url');

function assertInvalid(value: unknown, maxLength = 4_096) {
  assert.throws(() => decodeCanonicalTravelportStaysReference(value, maxLength), (error: unknown) => {
    assert.ok(error instanceof HospitalitySupplierProviderError);
    assert.equal(error.code, 'INVALID_REQUEST');
    return true;
  });
}

test('decodes canonical property and offer objects without changing their evidence', () => {
  for (const value of [
    { authority: 'TVPT', chainCode: 'HI', propertyCode: 'ABC12' },
    { propertyAuthority: 'TVPT', chainCode: 'HI', propertyCode: 'ABC12', rateAuthority: 'BKNG', rateValue: 'R-12' },
    { authority: 'TVPT', description: 'Café 東京' },
  ]) {
    assert.deepEqual(decodeCanonicalTravelportStaysReference(encode(value), 4_096), value);
  }
});

test('rejects non-canonical base64url aliases, malformed alphabet and length overflow', () => {
  const bytes = Buffer.from(JSON.stringify({ authority: 'TVPT', chainCode: 'HI', propertyCode: 'ABC12', x: '' }), 'utf8');
  assert.equal(bytes.length % 3, 1);
  const canonical = bytes.toString('base64url');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const index = alphabet.indexOf(canonical.at(-1)!);
  const alias = `${canonical.slice(0, -1)}${alphabet[index + 1]}`;
  assert.notEqual(alias, canonical);
  assert.equal(Buffer.from(alias, 'base64url').equals(bytes), true);
  for (const value of [alias, `${canonical}=`, ` ${canonical}`, `${canonical}\n`, 'invalid!', '', canonical.repeat(1000), null, 3]) assertInvalid(value);
  assertInvalid(canonical, canonical.length - 1);
  assertInvalid(canonical, 0);
});

test('rejects malformed UTF-8, malformed JSON, arrays and scalar JSON', () => {
  for (const bytes of [
    Buffer.from([0xff, 0xfe]),
    Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]),
    Buffer.from('{bad json}', 'utf8'),
    Buffer.from('[]', 'utf8'),
    Buffer.from('null', 'utf8'),
    Buffer.from('"string"', 'utf8'),
  ]) assertInvalid(bytes.toString('base64url'));
});


test('rejects alternate JSON spellings and duplicate supplier identity fields', () => {
  for (const raw of [
    '{ "authority":"TVPT","chainCode":"HI","propertyCode":"ABC12"}',
    '{"authority":"TVPT","chainCode":"HI","propertyCode":"ABC12"}\n',
    '{"authority":"TVPT","chainCode":"HI","propertyCode":"ABC12","propertyCode":"OTHER"}',
    '{"authority":"TVPT","chainCode":"HI","propertyCode":"ABC\\u0031"}',
    '{"authority":"TVPT","chainCode":"HI","propertyCode":"ABC12", "x":1e0}',
  ]) assertInvalid(encodeRaw(raw));
});
