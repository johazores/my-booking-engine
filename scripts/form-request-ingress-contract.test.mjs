import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const apiRoot = join(root, 'app', 'api');

function collectRoutes(directory) {
  const routes = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) routes.push(...collectRoutes(full));
    else if (entry.isFile() && entry.name === 'route.ts') {
      routes.push({
        path: relative(root, full).split(sep).join('/'),
        source: readFileSync(full, 'utf8'),
      });
    }
  }
  return routes;
}

test('production API routes do not parse unbounded browser forms', () => {
  const bypasses = collectRoutes(apiRoot)
    .filter(({ source }) => /\brequest\.formData\s*\(/.test(source))
    .map(({ path }) => path);
  assert.deepEqual(bypasses, []);
});

test('bounded browser form routes keep origin and media-type guards', () => {
  const routes = collectRoutes(apiRoot).filter(({ source }) => source.includes('readBoundedFormDataOrThrow(request)'));
  assert.ok(routes.length >= 22, 'expected all migrated non-inventory browser form routes');
  for (const { path, source } of routes) {
    assert.match(source, /isSameOriginAuthRequest\(request\)/, path);
    assert.match(source, /isSupportedAuthFormRequest\(request\)/, path);
  }
});


test('bounded browser form ingress caps streamed chunk count independently of bytes', () => {
  const body = readFileSync(join(root, 'src', 'server', 'http', 'bounded-form-body.ts'), 'utf8');
  const tests = readFileSync(join(root, 'src', 'server', 'inventory', 'inventory-form-body.test.ts'), 'utf8');
  assert.match(body, /const FORM_REQUEST_MAX_CHUNKS = 16 \* 1024/);
  assert.match(body, /chunkCount > FORM_REQUEST_MAX_CHUNKS/);
  assert.match(body, /Uint8Array\.prototype\.set\.call\(buffered, value, totalBytes\)/);
  assert.match(body, /Uint8Array\.prototype\.slice\.call\(buffered, 0, totalBytes\)/);
  assert.doesNotMatch(body, /chunks\.push/);
  assert.match(tests, /rejects endless zero-byte chunks/);
  assert.match(tests, /rejects excessive tiny chunks/);
  assert.match(tests, /never awaits stalled cancellation/);
  assert.match(tests, /preserves bytes from a reused upstream chunk buffer/);
  assert.doesNotMatch(body, /await reader\.cancel\(/);
});
