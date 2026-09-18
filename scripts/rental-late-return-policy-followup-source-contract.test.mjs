import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const route = read('app/api/inventory/rentals/unit-types/[unit-type-id]/late-return-policy/route.ts');
const page = read('app/inventory/rentals/types/[unit-type-id]/page.tsx');
const readme = read('README.md');
const foundation = read('docs/rental-booking-foundation.md');

test('late-return policy mutation reports real replay and policy-specific failure states', () => {
  assert.match(route, /const result = await reviseRentalLateReturnPolicy/);
  assert.match(route, /result\.idempotent \? 'late-return-policy-current' : 'late-return-policy-updated'/);
  assert.match(route, /error=late-return-policy-validation/);
  assert.match(route, /code === 'server' \? 'server' : `late-return-policy-\$\{code\}`/);

  for (const evidence of [
    "'late-return-policy-current': 'Late-return fee policy already matches this configuration; no duplicate revision was created.'",
    "'late-return-policy-permission': 'You do not have permission to revise rental pricing policy.'",
    "'late-return-policy-conflict': 'Late-return fee policy changed since this page was loaded. Refresh and try again.'",
    "'late-return-policy-validation': 'Check the late-return fee policy details and try again.'",
  ]) assert.ok(page.includes(evidence), evidence);
});

test('rental unit-type pagination keeps units and rate-period pages independent', () => {
  assert.ok(page.includes('unitTypeHref(inventory.unitType.id, inventory.units.page - 1, inventory.rates.page, pageSize)'), 'unit previous keeps rate page');
  assert.ok(page.includes('unitTypeHref(inventory.unitType.id, inventory.units.page + 1, inventory.rates.page, pageSize)'), 'unit next keeps rate page');
  assert.ok(page.includes('unitTypeHref(inventory.unitType.id, inventory.units.page, inventory.rates.page - 1, pageSize)'), 'rate previous keeps unit page');
  assert.ok(page.includes('unitTypeHref(inventory.unitType.id, inventory.units.page, inventory.rates.page + 1, pageSize)'), 'rate next keeps unit page');
});

test('top-level rental source docs describe automatic late-return policy as implemented', () => {
  assert.match(readme, /versioned unit-type late-return fee policy revisions with non-retroactive automatic fee math/i);
  assert.match(foundation, /versioned unit-type late-return fee policy revisions with non-retroactive automatic fee math/i);
  assert.doesNotMatch(readme, /automatic tenant late-fee policy/i);
  assert.doesNotMatch(foundation, /automatic tenant late-fee policy/i);
  assert.match(readme, /docs\/rental-late-return-policy\.md/);
  assert.match(foundation, /rental-late-return-policy\.md/);
});
