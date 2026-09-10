import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(
  'src/server/suppliers/travelport-stays-reservation-receipt-evidence.ts',
  'utf8',
);

test('Travelport Stays receipt authority rejects normalized outer whitespace and ASCII controls', () => {
  assert.match(source, /const normalized = value\.trim\(\);/);
  assert.match(source, /normalized !== value/);
  assert.match(source, /\[\\u0000-\\u001f\\u007f\]/);
  assert.doesNotMatch(source, /\/\[\\r\\n\]\/\.test\(normalized\)/);
  assert.match(source, /function hasValidOfferReferences\(value: unknown\)/);
  assert.match(source, /references\.some\(\(reference\) => reference === null\)/);
  assert.match(source, /new Set\(references\)\.size === references\.length/);
});

test('offer-scope token validation covers supported confirmations and relevant cancellations', () => {
  assert.match(source, /hasSupportedStaysPair && !hasValidOfferReferences\(receipt\.OfferRef\)/);
  assert.match(source, /if \(!hasValidOfferReferences\(receipt\.OfferRef\)\)/);
});
