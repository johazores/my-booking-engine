import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const parser = readFileSync(
  new URL('../src/server/suppliers/travelport-stays-reservation-response.ts', import.meta.url),
  'utf8',
);

test('known-locator machine authority requires exact bounded provider tokens', () => {
  assert.match(parser, /function boundedProviderValue\(value: unknown, max: number\)/);
  assert.match(parser, /const normalized = value\.trim\(\);/);
  assert.match(parser, /normalized !== value/);
  assert.match(parser, /\[\\u0000-\\u001f\\u007f\]/);
  assert.doesNotMatch(parser, /!normalized \|\| normalized\.length > max \|\| \/\[\\r\\n\]\//);

  for (const authorityExpression of [
    "boundedProviderValue(rawResultType, MAX_RESULT_TYPE_LENGTH)",
    "boundedProviderValue(rawWarningType, MAX_WARNING_TYPE_LENGTH)",
    "boundedProviderValue(reservation['@type'], MAX_RESERVATION_TYPE_LENGTH)",
    "boundedProviderValue(offer['@type'], MAX_OFFER_TYPE_LENGTH)",
    'boundedProviderValue(offer.id, MAX_OFFER_REFERENCE_LENGTH)',
    "boundedProviderValue(product['@type'], MAX_PRODUCT_TYPE_LENGTH)",
    "boundedProviderValue(rawPropertyKeyType, MAX_PROPERTY_KEY_TYPE_LENGTH)",
    'boundedProviderValue(propertyKey.chainCode, 16)',
    'boundedProviderValue(propertyKey.propertyCode, 32)',
    'boundedProviderValue(dateRange.start, 10)',
    'boundedProviderValue(dateRange.end, 10)',
    'boundedProviderValue(offerRef, MAX_OFFER_REFERENCE_LENGTH)',
    'boundedProviderValue(response.traceId ?? response.traceID, MAX_CORRELATION_LENGTH)',
  ]) {
    assert.ok(parser.includes(authorityExpression), `${authorityExpression} must stay on the exact provider-token guard`);
  }
});

test('human warning text remains separate from machine-token normalization', () => {
  assert.match(parser, /function boundedProviderText\(value: unknown, max: number\)/);
  assert.match(parser, /typeof value !== 'string' \|\| \/\[\\u0000-\\u001f\\u007f\]\/.test\(value\)/);
  assert.match(parser, /boundedProviderText\(warning\.Message, MAX_WARNING_MESSAGE_LENGTH\)/);
  assert.doesNotMatch(parser, /boundedProviderValue\(warning\.Message, MAX_WARNING_MESSAGE_LENGTH\)/);
});
