import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

const readme = read('README.md');
const architecture = read('docs/architecture.md');
const roadmap = read('docs/product-roadmap.md');
const inventory = read('docs/rental-inventory.md');
const foundation = read('docs/rental-booking-foundation.md');
const authority = read('docs/rental-booking-authority.md');
const cancellation = read('docs/rental-booking-cancellation.md');

const highLevelRentalDocs = [readme, architecture, roadmap, inventory, foundation, authority];

test('high-level rental docs describe the implemented one-amendment commercial boundary', () => {
  for (const source of highLevelRentalDocs) {
    assert.match(
      source,
      /one supported same-unit price-changing commercial (?:date )?amendment|one server-authoritative same-unit price-changing commercial date amendment|supported price-changing contract is deliberately narrow/i,
    );
  }

  for (const source of [readme, architecture, roadmap, inventory, foundation]) {
    assert.match(source, /second\/chained price-changing/i);
    assert.doesNotMatch(source, /price-changing rental amendments remain unimplemented/i);
    assert.doesNotMatch(source, /unit-type\/location-changing or price-changing\/broader rental amendments\/extensions/i);
  }

  assert.doesNotMatch(authority, /price-changing amendments\/rescheduling, customer self-service/i);
});

test('high-level rental docs retain current effective-settlement and manual-reference authority', () => {
  for (const source of [readme, roadmap, inventory, foundation]) {
    assert.match(source, /effective (?:post-amendment |post-apply )?(?:settlement|post-apply settlement)|effective-settlement/i);
  }

  for (const source of [readme, inventory, foundation]) {
    assert.match(source, /central (?:tenant-scoped |tenant-wide )?manual-reference|central `RentalManualProviderReference` registry/i);
  }

  for (const source of [roadmap, inventory, foundation]) {
    assert.match(source, /versioned unit-type late-return fee policy/i);
    assert.doesNotMatch(source, /automatic tenant(?:-wide)? late-fee policy/i);
  }
});

test('cancellation docs do not re-close supported post-amendment neutral mutations', () => {
  assert.match(cancellation, /second\/chained price-changing commercial amendment/i);
  assert.match(cancellation, /later same-unit price-neutral reschedules\/extensions/i);
  assert.match(cancellation, /same-type\/same-location pre-custody unit substitutions remain supported/i);
  assert.doesNotMatch(cancellation, /another post-apply reschedule or commercial amendment.*remain blocked/i);
});
