import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const commercial = readFileSync(
  new URL('../src/server/suppliers/travelport-stays-commercial-authority.ts', import.meta.url),
  'utf8',
);

test('present optional commercial structures must be objects', () => {
  assert.match(commercial, /function optionalRecord\(value: unknown\): RecordValue \| null/);
  assert.match(commercial, /if \(value === undefined \|\| value === null\) return null/);
  assert.match(commercial, /malformed commercial authority structure/);
});

test('SearchComplete nested commercial authority uses fail-closed object parsing', () => {
  assert.match(commercial, /optionalRecord\(penalty\.penalty\)/);
  assert.match(commercial, /optionalRecord\(providerPenalty\.currencyAmount\)/);
  assert.match(commercial, /optionalRecord\(rate\.price\)/);
  assert.match(commercial, /optionalRecord\(rate\.terms\)/);
});

test('Rules nested commercial authority uses fail-closed object parsing', () => {
  assert.match(commercial, /optionalRecord\(offer\.Price\)/);
  assert.match(commercial, /optionalRecord\(price\.CurrencyCode\)/);
  assert.match(commercial, /optionalRecord\(product\.PropertyKey\)/);
});
