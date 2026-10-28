import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Source-level regression guard only. Actual cleanup behavior requires disposable PostgreSQL.
const suites = [
  ['payment.integration.ts', ['adminA', 'staffA', 'adminB'], ['organizationA', 'organizationB']],
  ['hospitality-invoice-preparation.integration.ts', ['adminA', 'staffA', 'adminB'], ['organizationA', 'organizationB']],
  ['hospitality-invoice-issuance.integration.ts', ['adminA', 'staffA', 'adminB'], ['organizationA', 'organizationB']],
  ['hospitality-invoice-number-sequence-integrity.integration.ts', [], ['organization']],
];

for (const [filename, users, organizations] of suites) {
  test(`${filename} cleans partial payment/legal-document fixtures`, () => {
    const source = readFileSync(new URL(`../src/server/payments/${filename}`, import.meta.url), 'utf8');
    const cleanup = source.indexOf('async function cleanupFixtures()');
    const registration = source.indexOf('t.after(cleanupFixtures);');
    const firstFixture = source.search(/const (?:adminA|organization) = await db\.(?:user|organization)\.create/);
    assert.ok(cleanup > 0 && registration > cleanup && firstFixture > registration, 'cleanup must be registered before fixture writes');
    assert.match(source, /async \(t\) => \{/);
    assert.match(source, /finally \{\s*await cleanupFixtures\(\);/);
    const cleanupBody = source.slice(cleanup, registration);
    assert.match(cleanupBody, /if \(fixturesCleaned\) return;/);
    assert.match(cleanupBody, /fixturesCleaned = true;/);
    assert.match(cleanupBody, /db\.organization\.delete/);
    for (const name of [...users, ...organizations]) {
      assert.ok(source.includes(`const ${name}Id = crypto.randomUUID();`), `${name} ID must be allocated before writes`);
      assert.ok(source.includes(`id: ${name}Id,`), `${name} create must use its preassigned ID`);
      assert.ok(cleanupBody.includes(`${name}Id`), `${name} cleanup must not depend on a completed create result`);
    }
    if (filename !== 'hospitality-invoice-number-sequence-integrity.integration.ts') {
      assert.match(cleanupBody, /hospitalityBooking\.deleteMany/);
      assert.match(cleanupBody, /organizationMembership\.deleteMany/);
      assert.match(cleanupBody, /user\.deleteMany/);
    }
  });
}
