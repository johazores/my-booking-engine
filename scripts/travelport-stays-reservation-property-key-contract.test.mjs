import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFileSync(new URL(path, root), 'utf8');
const parser = source('src/server/suppliers/travelport-stays-reservation-response.ts');
const createClassifier = source('src/server/suppliers/travelport-stays-reservation-create-outcome.ts');

test('Travelport known-locator recovery validates explicit PropertyKey type before property identity authority', () => {
  assert.match(parser, /const MAX_PROPERTY_KEY_TYPE_LENGTH = 64;/);
  assert.match(parser, /function assertSupportedPropertyKeyType\(propertyKey: RecordValue\)/);
  assert.match(parser, /const rawPropertyKeyType = propertyKey\['@type'\];/);
  assert.match(parser, /rawPropertyKeyType === undefined \|\| rawPropertyKeyType === null\) return;/);
  assert.match(parser, /boundedProviderValue\(rawPropertyKeyType, MAX_PROPERTY_KEY_TYPE_LENGTH\)/);
  assert.match(parser, /propertyKeyType !== 'PropertyKey'/);

  const propertyRecord = parser.indexOf('const propertyKey = record(product.PropertyKey);');
  const discriminatorCheck = parser.indexOf('assertSupportedPropertyKeyType(propertyKey);');
  const chainAuthority = parser.indexOf('const chainCode = boundedProviderValue(propertyKey.chainCode, 16);');
  assert.ok(propertyRecord >= 0 && discriminatorCheck > propertyRecord && chainAuthority > discriminatorCheck);
});

test('commercial Create and Sync classification applies the same optional explicit PropertyKey contradiction rule', () => {
  assert.match(createClassifier, /const MAX_PROPERTY_KEY_TYPE_LENGTH = 64;/);
  assert.match(createClassifier, /const rawPropertyKeyType = property\['@type'\];/);
  assert.match(createClassifier, /rawPropertyKeyType !== undefined[\s\S]*?rawPropertyKeyType !== null[\s\S]*?boundedText\(rawPropertyKeyType, MAX_PROPERTY_KEY_TYPE_LENGTH\) !== 'PropertyKey'/);

  const propertyRecord = createClassifier.indexOf('const property = optionalRecord(product.PropertyKey);');
  const discriminatorCheck = createClassifier.indexOf("const rawPropertyKeyType = property['@type'];");
  const chainAuthority = createClassifier.indexOf('boundedText(property.chainCode, 16) === expected.chainCode');
  assert.ok(propertyRecord >= 0 && discriminatorCheck > propertyRecord && chainAuthority > discriminatorCheck);
});

test('PropertyKey discriminator hardening does not make omission mandatory or entangle payment evidence', () => {
  assert.match(parser, /rawPropertyKeyType === undefined \|\| rawPropertyKeyType === null\) return;/);
  assert.match(createClassifier, /rawPropertyKeyType !== undefined[\s\S]*?rawPropertyKeyType !== null/);
  assert.doesNotMatch(parser, /PropertyKey.*FormOfPayment|PropertyKey.*PaymentCard/s);
  assert.doesNotMatch(createClassifier, /PropertyKey.*FormOfPayment|PropertyKey.*PaymentCard/s);
});
