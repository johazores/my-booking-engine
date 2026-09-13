import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFileSync(new URL(path, root), 'utf8');

const provider = source('src/server/suppliers/travelport-stays-provider.ts');
const reservationMachineToken = source('src/server/suppliers/hospitality-supplier-machine-token.ts');
const prewriteUnicode = source('src/server/suppliers/travelport-stays-json-unicode-authority.ts');
const docs = source('docs/travelport-stays-transport-unicode-authority.md');

test('Travelport public transport machine tokens require well-formed Unicode', () => {
  assert.match(
    provider,
    /function exactMachineToken\([\s\S]*!value\.isWellFormed\(\)[\s\S]*ASCII_CONTROL_PATTERN\.test\(value\)/,
  );
  assert.match(
    provider,
    /function exactConfigurationValue\([\s\S]*!value\.isWellFormed\(\)[\s\S]*ASCII_CONTROL_PATTERN\.test\(value\)/,
  );
});

test('present Travelport response machine evidence cannot bypass validation by using a non-string type', () => {
  assert.match(
    provider,
    /function exactResponseTokenIfPresent\([\s\S]*value === undefined \|\| value === null[\s\S]*exactMachineToken\(value, max, 'response'\)/,
  );
});

test('related reservation Unicode boundaries remain independently fail-closed', () => {
  assert.match(reservationMachineToken, /value\.isWellFormed\(\)/);
  assert.match(prewriteUnicode, /!current\.isWellFormed\(\)/);
  assert.match(prewriteUnicode, /!key\.isWellFormed\(\)/);
  assert.match(docs, /INVALID_REQUEST/);
  assert.match(docs, /INVALID_RESPONSE/);
  assert.match(docs, /OAuth/);
  assert.match(docs, /pagination replay/i);
  assert.match(docs, /reservation machine-token boundary/i);
});
