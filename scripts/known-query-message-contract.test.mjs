import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { readKnownQueryMessage } from '../src/lib/known-query-message.ts';

test('query feedback only renders explicitly owned string messages', () => {
  const messages = { created: 'Created.', error: 'Try again.' };
  assert.equal(readKnownQueryMessage(messages, 'created'), 'Created.');
  assert.equal(readKnownQueryMessage(messages, 'error'), 'Try again.');
  for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'unknown', '', ['created'], { toString: () => 'created' }, null, undefined]) {
    assert.equal(readKnownQueryMessage(messages, key), undefined);
  }
  assert.equal(readKnownQueryMessage({ created: 12 }, 'created'), undefined);
  assert.equal(readKnownQueryMessage(Object.create({ created: 'Inherited.' }), 'created'), undefined);
  const nullPrototype = Object.assign(Object.create(null), { created: 'Created.' });
  assert.equal(readKnownQueryMessage(nullPrototype, 'created'), 'Created.');
});

test('server-rendered page feedback does not index user query keys into message objects directly', () => {
  const pages = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name === 'page.tsx') pages.push(path);
    }
  }
  visit(new URL('../app/', import.meta.url).pathname);
  const unsafe = /\b(?:statuses|messages|errors|statusMessages|organizationErrors|settingsErrors|archiveErrors|roleErrors|memberErrors|applyErrors|errorMessages)\[(?:params|query)\.[A-Za-z_$][\w$]*\]/g;
  for (const path of pages) {
    const source = readFileSync(path, 'utf8');
    assert.equal(unsafe.test(source), false, `Unsafe query feedback lookup: ${path}`);
    unsafe.lastIndex = 0;
  }
});
