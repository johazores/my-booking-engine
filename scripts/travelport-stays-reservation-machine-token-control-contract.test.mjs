import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('reservation commercial machine-token boundaries reject the full ASCII control range', () => {
  for (const path of [
    'src/server/suppliers/travelport-stays-response-trace.ts',
    'src/server/suppliers/hospitality-supplier-reservation-payment-authority.ts',
    'src/server/suppliers/travelport-stays-reservation-create-request-material.ts',
    'src/server/suppliers/travelport-stays-reservation-sync-domain.ts',
    'src/server/suppliers/travelport-stays-reservation-identity.ts',
  ]) {
    assert.match(
      source(path),
      /\[\\u0000-\\u001f\\u007f\]/,
      `${path} must reject every ASCII control family from reservation machine evidence`,
    );
  }
});

test('normalized create-payment authority never trims supplier card capability tokens into valid authority', () => {
  const paymentAuthority = source('src/server/suppliers/hospitality-supplier-reservation-payment-authority.ts');
  assert.match(paymentAuthority, /value\.trim\(\) !== value/);
  assert.match(paymentAuthority, /ASCII_CONTROL_PATTERN\.test\(value\)/);
  assert.doesNotMatch(paymentAuthority, /const code = value\.trim\(\)/);
  assert.match(paymentAuthority, /normalized\.push\(value\)/);
});

test('outbound Create and Sync retain exact-value checks before composing provider writes', () => {
  const createMaterial = source('src/server/suppliers/travelport-stays-reservation-create-request-material.ts');
  const sync = source('src/server/suppliers/travelport-stays-reservation-sync-domain.ts');

  assert.match(createMaterial, /normalized !== value/);
  assert.match(createMaterial, /code !== code\.trim\(\)/);
  assert.match(createMaterial, /ASCII_CONTROL_PATTERN\.test\(normalized\)/);
  assert.match(createMaterial, /ASCII_CONTROL_PATTERN\.test\(code\)/);

  assert.match(sync, /normalized !== value/);
  assert.match(sync, /ASCII_CONTROL_PATTERN\.test\(normalized\)/);
});

test('known-locator property references remain exact and canonically encoded', () => {
  const identity = source('src/server/suppliers/travelport-stays-reservation-identity.ts');

  assert.match(identity, /value\.trim\(\) !== value/);
  assert.match(identity, /ASCII_CONTROL_PATTERN\.test\(value\)/);
  assert.match(identity, /decodedBytes\.toString\('base64url'\) !== encoded/);
  assert.doesNotMatch(identity, /identity\.chainCode\.trim\(\)/);
  assert.doesNotMatch(identity, /identity\.propertyCode\.trim\(\)/);
});
