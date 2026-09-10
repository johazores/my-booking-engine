import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const parser = readFileSync(
  new URL('../src/server/suppliers/travelport-stays-reservation-response.ts', import.meta.url),
  'utf8',
);

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

test('PropertyKey discriminator hardening stays scoped to durable Retrieve identity', () => {
  const expectedBoundary = parser.indexOf('if (input.expectedReservation) {');
  const matchingBoundary = parser.indexOf('const offerScope = assertExpectedReservationMatch(reservation, input.expectedReservation);');
  assert.ok(expectedBoundary >= 0 && matchingBoundary > expectedBoundary);
  assert.doesNotMatch(parser, /PropertyKey.*FormOfPayment|PropertyKey.*PaymentCard/s);
});
