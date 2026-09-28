import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../app/book/[organization-slug]/public-booking-tax-invoices.tsx', import.meta.url),
  'utf8',
);

test('public tax-document history preserves verified evidence across recoverable refresh states', () => {
  assert.match(source, /response\.status === 404\) return/);
  assert.doesNotMatch(source, /setHistory\(null\)/);
  assert.match(source, /Loading issued tax documents/);
  assert.match(source, /role="status"/);
  assert.match(source, /role="alert"/);
  assert.match(source, /aria-busy=\{busy \|\| undefined\}/);
  assert.match(source, /Try again/);
  assert.match(source, /window\.setTimeout\(\(\) => URL\.revokeObjectURL\(objectUrl\), 1_000\)/);
  assert.doesNotMatch(source, /anchor\.remove\(\);\s*URL\.revokeObjectURL\(objectUrl\)/);
});
