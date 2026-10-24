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
    { chainCode: 'HI', propertyCode: 'ABC12', propertyAuthority: 'TVPT', rateValue: 'Café 東京', rateAuthority: 'TVPT' },
  ]) {
    assert.deepEqual(decodeCanonicalTravelportStaysReference(encode(value), 4_096), value);
  }
});

test('rejects non-canonical base64url aliases, malformed alphabet and length overflow', () => {
  const bytes = Buffer.from(JSON.stringify({ authority: 'TVPT', chainCode: 'HII', propertyCode: 'ABC12' }), 'utf8');
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


test('rejects extra, missing, conflicting, and prototype-shaped supplier reference fields', () => {
  for (const value of [
    { authority: 'TVPT', chainCode: 'HI', propertyCode: 'ABC12', metadata: 'untrusted' },
    { authority: 'TVPT', chainCode: 'HI' },
    { authority: 'TVPT', chainCode: 'HI', propertyCode: 'ABC12', propertyAuthority: 'TVPT' },
    { chainCode: 'HI', propertyCode: 'ABC12', propertyAuthority: 'TVPT', rateValue: 'R-12', rateAuthority: 'BKNG', note: 'untrusted' },
    { chainCode: 'HI', propertyCode: 'ABC12', propertyAuthority: 'TVPT', rateValue: 'R-12' },
    JSON.parse('{"authority":"TVPT","chainCode":"HI","propertyCode":"ABC12","__proto__":{"polluted":true}}'),
  ]) assertInvalid(encode(value));
});

test('rejects identity values that only become valid after normalization', () => {
  const property = { authority: 'TVPT', chainCode: 'HI', propertyCode: 'ABC12' };
  const offer = { propertyAuthority: 'TVPT', chainCode: 'HI', propertyCode: 'ABC12', rateAuthority: 'TVPT', rateValue: 'R-12' };
  for (const value of [
    { ...property, authority: 'OTHER' },
    { ...property, chainCode: ' HI' },
    { ...property, chainCode: 'HI\t' },
    { ...property, propertyCode: 'ABC 12' },
    { ...property, propertyCode: 'ABC12 ' },
    { ...offer, propertyAuthority: 'OTHER' },
    { ...offer, rateAuthority: 'OTHER' },
    { ...offer, rateValue: ' R-12' },
    { ...offer, rateValue: 'R-12 ' },
    { ...offer, rateValue: 'R\t12' },
    { ...offer, rateValue: 'R\u007f12' },
    { ...offer, rateValue: '\ud800' },
    { ...offer, rateValue: '' },
    { ...offer, rateValue: 123 },
  ]) assertInvalid(encode(value));
});
