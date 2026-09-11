import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('traveler email authority rejects the full ASCII control range before fingerprinting', () => {
  const authority = source('src/server/suppliers/hospitality-supplier-reservation-traveler-authority.ts');
  const behavior = source('src/server/suppliers/hospitality-supplier-reservation-traveler-authority.test.ts');

  assert.match(authority, /ASCII_CONTROL_PATTERN = \/\[\\u0000-\\u001f\\u007f\]\//);
  assert.match(authority, /ASCII_CONTROL_PATTERN\.test\(email\)/);
  assert.match(authority, /const email = input\.email\.trim\(\)\.toLowerCase\(\)/);
  assert.match(behavior, /ada\\u0000@example\.com/);
  assert.match(behavior, /ada\\u001f@example\.com/);
  assert.match(behavior, /ada\\u007f@example\.com/);
});

test('Travelport sensitive Create single-line text rejects ASCII controls before request serialization', () => {
  const executor = source('src/server/suppliers/travelport-stays-reservation-create-executor.ts');
  const behavior = source('src/server/suppliers/travelport-stays-reservation-create-payment-card.test.ts');

  assert.match(executor, /ASCII_CONTROL_PATTERN = \/\[\\u0000-\\u001f\\u007f\]\//);
  const guardIndex = executor.indexOf('ASCII_CONTROL_PATTERN.test(normalized)');
  const cardholderIndex = executor.indexOf("boundedSingleLine(input.cardHolderName, 'Travelport payment card holder name'");
  const serializeIndex = executor.indexOf('const serializedBody = JSON.stringify(requestBody)');
  assert.ok(guardIndex >= 0 && cardholderIndex > guardIndex && serializeIndex > cardholderIndex);
  assert.match(behavior, /Ada\\u0000Lovelace/);
  assert.match(behavior, /Ada\\tLovelace/);
  assert.match(behavior, /Main\\u001fSt/);
  assert.match(behavior, /N\\u007fSW/);
});

test('request-text authority remains product-unreachable and documented as pre-provider validation', () => {
  const docs = source('docs/travelport-reservation-request-text-authority.md');
  const packageJson = JSON.parse(source('package.json'));

  assert.match(packageJson.scripts.test, /scripts\/\*\.test\.mjs/);
  assert.match(packageJson.scripts.test, /src\/server\/suppliers\/\*\.test\.ts/);
  assert.match(docs, /U\+0000.*U\+001F.*U\+007F/s);
  assert.match(docs, /before `beforeProviderRequest`/);
  assert.match(docs, /PAN, CVV\/security code.*remain ephemeral/s);
  assert.match(docs, /`reservation` remains deliberately disabled/);
});
