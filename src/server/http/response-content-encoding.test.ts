import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyHttpResponseContentEncoding } from './response-content-encoding.ts';

test('HTTP content coding classification distinguishes identity from real codings', () => {
  const cases: Array<readonly [string | null, 'identity' | 'encoded' | 'invalid']> = [
    [null, 'identity'],
    ['identity', 'identity'],
    ['IDENTITY', 'identity'],
    ['identity, identity', 'identity'],
    ['gzip', 'encoded'],
    ['gzip, br', 'encoded'],
    ['identity, gzip', 'encoded'],
    ['zstd', 'encoded'],
    ['', 'invalid'],
    ['gzip,', 'invalid'],
    [',gzip', 'invalid'],
    ['gzip,,br', 'invalid'],
    ['gzip;level=1', 'invalid'],
    ['gzip / br', 'invalid'],
    ['x'.repeat(513), 'invalid'],
    [Array(17).fill('gzip').join(','), 'invalid'],
  ];
  for (const [value, expected] of cases) {
    const headers = new Headers();
    if (value !== null) headers.set('content-encoding', value);
    assert.equal(classifyHttpResponseContentEncoding(headers), expected, String(value));
  }
});
