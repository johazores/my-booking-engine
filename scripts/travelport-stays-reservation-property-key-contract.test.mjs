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
  assert.match(parser, /if \(rawPropertyKeyType === undefined\) return;/);
  assert.match(parser, /boundedProviderValue\(rawPropertyKeyType, MAX_PROPERTY_KEY_TYPE_LENGTH\)/);
  assert.match(parser, /propertyKeyType !== 'PropertyKey'/);
  assert.doesNotMatch(parser, /rawPropertyKeyType === undefined \|\| rawPropertyKeyType === null\) return;/);

  const propertyRecord = parser.indexOf('const propertyKey = record(product.PropertyKey);');
  const discriminatorCheck = parser.indexOf('assertSupportedPropertyKeyType(propertyKey);');
  const chainAuthority = parser.indexOf('const chainCode = boundedProviderValue(propertyKey.chainCode, 16);');
  assert.ok(propertyRecord >= 0 && discriminatorCheck > propertyRecord && chainAuthority > discriminatorCheck);
});

test('commercial Create and Sync classification applies the same absent-not-null PropertyKey rule', () => {
  assert.match(createClassifier, /const MAX_PROPERTY_KEY_TYPE_LENGTH = 64;/);
  assert.match(createClassifier, /const rawPropertyKeyType = property\['@type'\];/);
  assert.match(createClassifier, /rawPropertyKeyType !== undefined[\s\S]*?boundedText\(rawPropertyKeyType, MAX_PROPERTY_KEY_TYPE_LENGTH\) !== 'PropertyKey'/);
  assert.doesNotMatch(createClassifier, /rawPropertyKeyType !== undefined[\s\S]{0,120}?rawPropertyKeyType !== null/);

  const propertyRecord = createClassifier.indexOf('const property = optionalRecord(product.PropertyKey);');
  const discriminatorCheck = createClassifier.indexOf("const rawPropertyKeyType = property['@type'];");
  const chainAuthority = createClassifier.indexOf('boundedText(property.chainCode, 16) === expected.chainCode');
  assert.ok(propertyRecord >= 0 && discriminatorCheck > propertyRecord && chainAuthority > discriminatorCheck);
});

test('commercial optional Offer.id compatibility also distinguishes omission from explicit null', () => {
  assert.match(createClassifier, /const rawOfferId = offer\.id;/);
  assert.match(createClassifier, /const hasOfferId = rawOfferId !== undefined;/);
  assert.match(createClassifier, /const offerId = hasOfferId[\s\S]*?boundedText\(rawOfferId, MAX_OFFER_REFERENCE_LENGTH\)[\s\S]*?: null;/);
  assert.match(createClassifier, /\(hasOfferId && !offerId\)/);
});

test('known-locator passive scope treats explicit null as malformed while preserving genuine omission', () => {
  assert.match(parser, /const passiveOfferInd = offer\.passiveOfferInd;/);
  assert.match(parser, /passiveOfferInd !== undefined[\s\S]*?typeof passiveOfferInd !== 'boolean'/);
  assert.doesNotMatch(parser, /passiveOfferInd !== undefined[\s\S]{0,120}?passiveOfferInd !== null/);
  assert.match(parser, /if \(passiveOfferInd === true\)/);
});

test('structural discriminator hardening remains isolated from payment evidence', () => {
  assert.doesNotMatch(parser, /PropertyKey.*FormOfPayment|PropertyKey.*PaymentCard/s);
  assert.doesNotMatch(createClassifier, /PropertyKey.*FormOfPayment|PropertyKey.*PaymentCard/s);
});
