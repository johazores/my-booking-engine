import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('reservation machine authority distinguishes omission from explicit null', async () => {
  const authority = await source('src/server/suppliers/travelport-stays-reservation-response-authority.ts');

  assert.match(authority, /function boundedArray\(value: unknown, max: number\)[\s\S]*?if \(value === undefined\) return \[\];/);
  assert.doesNotMatch(authority, /if \(value === undefined \|\| value === null\) return \[\];/);
  assert.match(authority, /function assertExactMachineStringIfPresent[\s\S]*?if \(value === undefined\) return;/);
  assert.match(authority, /function validateResult[\s\S]*?if \(response\.Result === undefined\)/);
  assert.match(authority, /function validateReservation[\s\S]*?if \(response\.Reservation === undefined\) return;/);
  assert.match(authority, /function validateReceiptBranch[\s\S]*?if \(value === undefined\) return;/);
  assert.match(authority, /if \(branch\.Locator !== undefined\) validateLocator\(branch\.Locator\);/);
  assert.match(authority, /explicit null values[\s\S]*?omitted optional machine evidence/);
});

test('null-machine authority documentation preserves activation and fail-closed scope', async () => {
  const doc = await source('docs/travelport-reservation-null-machine-authority.md');
  const envelopeDoc = await source('docs/travelport-reservation-envelope-null-authority.md');
  assert.match(doc, /explicit JSON `null` is not equivalent to omission/);
  assert.match(doc, /Result/);
  assert.match(doc, /Reservation/);
  assert.match(doc, /Locator/);
  assert.match(doc, /does not enable Travelport `reservation`/);
  assert.match(doc, /PCI-safe FormOfPayment\/guarantee source/);
  assert.match(envelopeDoc, /## Shared machine-authority enforcement/);
  assert.match(envelopeDoc, /optional only when the property is genuinely absent/);
});
