import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

for (const flow of ['sign-in', 'sign-up']) {
  test(`${flow} rate-limit redirect preserves database wait for the browser`, () => {
    const route = readFileSync(new URL(`../app/api/auth/${flow}/route.ts`, import.meta.url), 'utf8');
    const page = readFileSync(new URL(`../app/${flow}/page.tsx`, import.meta.url), 'utf8');

    assert.match(route, /redirectUrl\.searchParams\.set\('error', 'rate-limited'\)/);
    assert.match(route, /redirectUrl\.searchParams\.set\('retry', String\(attempt\.retryAfterSeconds\)\)/);
    assert.match(route, /response\.headers\.set\('Retry-After', String\(attempt\.retryAfterSeconds\)\)/);
    assert.match(page, /getAuthRateLimitMessage\(params\.retry\)/);
    assert.match(page, /role="alert"/);
  });
}
