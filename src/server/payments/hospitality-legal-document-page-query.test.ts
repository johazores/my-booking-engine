import assert from 'node:assert/strict';
import test from 'node:test';

import { parseHospitalityLegalDocumentPage } from './hospitality-legal-document-page-query.ts';

test('normalizes valid legal-document register pages within the service boundary', () => {
  for (const [input, expected] of [['1', 1], ['2', 2], ['00025', 25], ['100000', 100_000]] as const) {
    assert.equal(parseHospitalityLegalDocumentPage(input), expected);
  }
  assert.equal(parseHospitalityLegalDocumentPage(undefined), 1);
});

test('rejects duplicate and non-decimal page query values without coercion', () => {
  const invalid: Array<string | string[] | undefined> = [
    '', '0', '-1', '+2', ' 2 ', '2 ', '2.0', '2e1', '0x10', '2foo', '100001',
    '999999999999999999999999999999', ['2'], ['2', '3'], ['__proto__'],
  ];
  for (const value of invalid) {
    assert.equal(parseHospitalityLegalDocumentPage(value), 1, JSON.stringify(value));
  }
});
