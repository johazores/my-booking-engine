import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const decoder = readFileSync(new URL('../src/server/suppliers/travelport-stays-reference-decoder.ts', import.meta.url), 'utf8');

const paths = [
  'src/server/suppliers/travelport-stays-provider-core.ts',
  'src/server/suppliers/travelport-stays-booking-terms-provider-core.ts',
  'src/server/suppliers/travelport-stays-reservation-authority-provider-core.ts',
  'src/server/suppliers/travelport-stays-provider.ts',
  'src/server/suppliers/travelport-stays-reservation-identity.ts',
];

test('Travelport supplier reference entry points share canonical decoding', () => {
  for (const path of paths) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    assert.match(source, /import \{ decodeCanonicalTravelportStaysReference \} from '\.\/travelport-stays-reference-decoder\.ts';/, path);
    assert.match(source, /decodeCanonicalTravelportStaysReference\((?:value|encoded),\s*MAX_\w+\)/, path);
    assert.doesNotMatch(source, /Buffer\.from\((?:value|encoded),\s*'base64url'\)/, path);
  }
});


test('shared Travelport decoder requires exact reference shapes and machine identity', () => {
  assert.match(decoder, /hasExactKeys\(reference, PROPERTY_KEYS\)/);
  assert.match(decoder, /hasExactKeys\(reference, OFFER_KEYS\)/);
  assert.match(decoder, /rateValue\.isWellFormed\(\)/);
  assert.match(decoder, /ASCII_CONTROL_PATTERN\.test\(rateValue\)/);
});
