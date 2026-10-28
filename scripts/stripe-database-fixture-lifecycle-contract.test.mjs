import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const suites = [
  ['stripe-payment.integration.ts', ['adminA', 'staffA', 'adminB'], ['organizationA', 'organizationB']],
  ['stripe-refund.integration.ts', ['adminA', 'staffA', 'adminB'], ['organizationA', 'organizationB']],
  ['stripe-refund-webhook.integration.ts', ['admin'], ['organization']],
];

for (const [filename, users, organizations] of suites) {
  test(`${filename} registers partial-fixture cleanup before any database writes`, () => {
    const source = readFileSync(new URL(`../src/server/payments/${filename}`, import.meta.url), 'utf8');
    const firstWrite = source.indexOf('await db.user.create(');
    const cleanup = source.indexOf('t.after(async () => {');
    assert.ok(firstWrite > 0 && cleanup > 0 && cleanup < firstWrite);
    assert.match(source, /async \(t\) => \{/);
    const after = source.slice(cleanup, firstWrite);
    for (const name of [...users, ...organizations]) {
      assert.match(source.slice(0, firstWrite), new RegExp(`const ${name}Id = crypto\\.randomUUID\\(\\);`));
      assert.ok(source.includes(`id: ${name}Id,`), `${name} must be created with its preassigned ID`);
    }
    for (const model of ['paymentTransaction', 'hospitalityBooking', 'hospitalityAvailabilityHold', 'integration', 'organizationMembership', 'organization', 'user']) {
      assert.ok(after.includes(`db.${model}.deleteMany(`), `${model} cleanup must be registered before writes`);
    }
    for (const name of organizations) assert.ok(after.includes(`${name}Id`));
    for (const name of users) assert.ok(after.includes(`${name}Id`));
  });
}

test('Stripe payment fixture cleanup is not delayed until the fetch-restoration finally', () => {
  const source = readFileSync(new URL('../src/server/payments/stripe-payment.integration.ts', import.meta.url), 'utf8');
  const finallyBlock = source.slice(source.lastIndexOf('  } finally {'));
  assert.match(finallyBlock, /globalThis\.fetch = originalFetch/);
  assert.doesNotMatch(finallyBlock, /deleteMany\(/);
});
