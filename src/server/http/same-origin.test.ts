import assert from 'node:assert/strict';
import test from 'node:test';
import { isSameOriginRequest } from './same-origin.ts';

function request(url: string, origin?: string) {
  return new Request(url, { headers: origin === undefined ? {} : { origin } });
}

test('accepts only exact serialized HTTP(S) origins, including local development ports', () => {
  for (const [url, origin] of [
    ['https://booking.example.com/api/holds', 'https://booking.example.com'],
    ['http://localhost:3000/api/auth/sign-in', 'http://localhost:3000'],
    ['https://booking.example.com:8443/api', 'https://booking.example.com:8443'],
  ]) assert.equal(isSameOriginRequest(request(url, origin)), true, origin);
});

test('rejects missing, cross-origin, opaque, and noncanonical Origin values', () => {
  const target = 'https://booking.example.com/api/holds';
  for (const origin of [
    undefined, 'null', 'not a url', 'https://attacker.example',
    'http://booking.example.com', 'https://booking.example.com.evil.test',
    'https://booking.example.com/', 'https://booking.example.com/path',
    'https://booking.example.com?x=1', 'https://booking.example.com#fragment',
    'https://booking.example.com:443', 'HTTPS://BOOKING.EXAMPLE.COM',
    'https://booking.example.com https://attacker.example',
    'https://user@booking.example.com',
  ]) assert.equal(isSameOriginRequest(request(target, origin)), false, String(origin));
  assert.equal(isSameOriginRequest(request('data:text/plain,hello', 'null')), false);
});
