import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = (path) => readFileSync(resolve(root, path), 'utf8');

test('both credential forms accept the full server-valid Unicode password range', () => {
  for (const path of ['app/sign-in/page.tsx', 'app/sign-up/page.tsx']) {
    const page = source(path);
    assert.match(page, /name="password"[^>]*minLength=\{12\}[^>]*maxLength=\{256\}/);
    assert.doesNotMatch(page, /name="password"[^>]*maxLength=\{128\}/);
  }
});

test('registration names follow PostgreSQL code-point length rather than UTF-16 length', () => {
  const page = source('app/sign-up/page.tsx');
  const domain = source('src/server/auth/auth-domain.ts');
  const tests = source('src/server/auth/auth-domain.test.ts');
  assert.match(page, /name="displayName"[^>]*maxLength=\{320\}[^>]*aria-describedby="display-name-help"/);
  assert.match(page, /id="display-name-help">Up to 160 characters/);
  assert.match(page, /validation: .*names at most 160 characters/);
  assert.match(domain, /\[\.\.\.displayName\]\.length > 160/);
  assert.match(tests, /'😀'\.repeat\(160\)/u);
  assert.match(tests, /'😀'\.repeat\(161\)/u);
});
