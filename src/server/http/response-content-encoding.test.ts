import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyHttpResponseContentEncoding, hasInconsistentProviderResponseLength, hasUnsafeProviderResponseFraming } from './response-content-encoding.ts';

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
    [' gzip \t, identity ', 'encoded'],
    ['gzip\u00a0', 'invalid'],
    ['gzip\v', 'invalid'],
    ['gzip\f', 'invalid'],
    ['identity\u00a0', 'invalid'],
  ];
  for (const [value, expected] of cases) {
    const headers = new Headers();
    if (value !== null) headers.set('content-encoding', value);
    assert.equal(classifyHttpResponseContentEncoding(headers), expected, String(value));
  }
});

test('provider framing rejects partial success and contradictory wire boundaries', () => {
  const cases: Array<readonly [number, Record<string, string>, boolean]> = [
    [200, {}, false],
    [201, {}, false],
    [206, {}, true],
    [206, { 'content-range': 'bytes 0-2/10' }, true],
    [200, { 'content-range': 'bytes 0-2/10' }, true],
    [201, { 'content-range': 'bytes 0-2/10' }, true],
    [416, { 'content-range': 'bytes */10' }, false],
    [200, { 'transfer-encoding': 'chunked' }, false],
    [200, { 'content-length': '3' }, false],
    [200, { 'transfer-encoding': 'chunked', 'content-length': '3' }, true],
    [400, { 'transfer-encoding': 'chunked', 'content-length': '3' }, true],
  ];
  for (const [status, headers, expected] of cases) {
    assert.equal(hasUnsafeProviderResponseFraming(new Headers(headers), status), expected);
  }
});

test('provider response lengths reject impossible encoded zero-byte evidence', () => {
  const cases: Array<readonly [number | null, number, 'identity' | 'encoded', boolean]> = [
    [null, 100, 'identity', false],
    [null, 100, 'encoded', false],
    [0, 0, 'identity', false],
    [0, 2, 'identity', true],
    [2, 2, 'identity', false],
    [2, 3, 'identity', true],
    [0, 0, 'encoded', false],
    [0, 2, 'encoded', true],
    [1, 2, 'encoded', false],
    [20, 2, 'encoded', false],
  ];
  for (const [declared, received, encoding, expected] of cases) {
    assert.equal(hasInconsistentProviderResponseLength(declared, received, encoding), expected);
  }
});
