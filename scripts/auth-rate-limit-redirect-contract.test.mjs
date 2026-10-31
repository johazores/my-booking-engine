import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

for (const flow of ['sign-in', 'sign-up']) {
  test(`${flow} quota denial preserves a bounded database wait through a safe local redirect`, () => {
    const route = readFileSync(new URL(`../app/api/auth/${flow}/route.ts`, import.meta.url), 'utf8');
    const page = readFileSync(new URL(`../app/${flow}/page.tsx`, import.meta.url), 'utf8');
    const expectedRedirect = `const response = redirectToLocalPath(\`/${flow}?error=rate-limited&retry=\${attempt.retryAfterSeconds}\`);`;

    assert.match(route, /if \(!attempt\.allowed\) \{\s*const response = redirectToLocalPath\(/);
    assert.ok(route.includes(expectedRedirect), `${flow} must redirect locally with the database wait`);
    assert.match(route, /response\.headers\.set\('Retry-After', String\(attempt\.retryAfterSeconds\)\)/);
    assert.match(route, /return finish\(response, 'rejected', true\)/);
    assert.match(route, /applyAuthResponseNoStore\(response\)/);
    assert.match(page, /params\.error === 'rate-limited'\s*\?\s*getAuthRateLimitMessage\(params\.retry\)/);
    assert.match(page, /role="alert"/);
  });
}
