import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const operations = [
  'customer.create',
  'customer.update',
  'customer.archive',
  'customer.deidentify',
  'pricing.addon.create',
  'pricing.addon.archive',
  'pricing.base-rate.create',
  'pricing.base-rate.archive',
  'pricing.charge.create',
  'pricing.charge.archive',
  'inventory.amenity.create',
  'inventory.amenity.archive',
  'inventory.property-amenity.mutate',
  'inventory.room-type-amenity.mutate',
  'inventory.image.mutate',
  'inventory.property.create',
  'inventory.property.archive',
  'inventory.rate-plan.create',
  'inventory.rate-plan.archive',
  'inventory.rate-plan-room-type.mutate',
  'inventory.restriction.create',
  'inventory.restriction.archive',
  'inventory.room-type.create',
  'inventory.room-type.archive',
  'inventory.room.create',
  'inventory.room.archive',
];

test('observability documentation lists every reviewed customer, pricing, and inventory operation', () => {
  const docs = readFileSync('docs/observability.md', 'utf8');
  for (const operation of operations) {
    assert.ok(docs.includes(`\`${operation}\``), `docs must include ${operation}`);
  }
});

test('observability documentation preserves the management privacy boundary', () => {
  const docs = readFileSync('docs/observability.md', 'utf8');
  assert.match(docs, /Customer IDs, names, email, phone, notes/);
  assert.match(docs, /Property, room-type, room, amenity, image, rate-plan, restriction/);
  assert.match(docs, /Property\/room-type\/rate-plan\/add-on\/base-rate\/charge identifiers/);
  assert.match(docs, /GitHub Actions are not used for validation/);
});
