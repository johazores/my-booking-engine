import assert from 'node:assert/strict';
import test from 'node:test';

import {
  rentalLocationLifecycleLockKey,
  rentalUnitLockKey,
  rentalUnitTypeLifecycleLockKey,
} from './rental-lock-domain.ts';

test('rental lock keys separate physical-unit and parent lifecycle namespaces', () => {
  assert.equal(rentalUnitLockKey('org-a', 'unit-a'), 'sf:rental-unit:org-a:unit-a');
  assert.equal(
    rentalLocationLifecycleLockKey('org-a', 'location-a'),
    'sf:rental-location-lifecycle:org-a:location-a',
  );
  assert.equal(
    rentalUnitTypeLifecycleLockKey('org-a', 'type-a'),
    'sf:rental-unit-type-lifecycle:org-a:type-a',
  );
});
