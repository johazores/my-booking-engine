import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertMembershipStatusTransition,
  canMembershipAccessTenant,
  canTransitionMembershipStatus,
} from './membership-domain.ts';

test('only active memberships grant tenant access', () => {
  assert.equal(canMembershipAccessTenant('ACTIVE'), true);
  assert.equal(canMembershipAccessTenant('INVITED'), false);
  assert.equal(canMembershipAccessTenant('SUSPENDED'), false);
  assert.equal(canMembershipAccessTenant('ARCHIVED'), false);
});

test('invited memberships can be accepted or archived', () => {
  assert.equal(canTransitionMembershipStatus('INVITED', 'ACTIVE'), true);
  assert.equal(canTransitionMembershipStatus('INVITED', 'ARCHIVED'), true);
  assert.equal(canTransitionMembershipStatus('INVITED', 'SUSPENDED'), false);
});

test('active and suspended memberships have explicit reversible suspension rules', () => {
  assert.equal(canTransitionMembershipStatus('ACTIVE', 'SUSPENDED'), true);
  assert.equal(canTransitionMembershipStatus('SUSPENDED', 'ACTIVE'), true);
  assert.equal(canTransitionMembershipStatus('ACTIVE', 'ARCHIVED'), true);
  assert.equal(canTransitionMembershipStatus('SUSPENDED', 'ARCHIVED'), true);
});

test('archived memberships are terminal and invalid transitions throw', () => {
  assert.equal(canTransitionMembershipStatus('ARCHIVED', 'ACTIVE'), false);
  assert.equal(canTransitionMembershipStatus('ARCHIVED', 'INVITED'), false);
  assert.throws(
    () => assertMembershipStatusTransition('ARCHIVED', 'ACTIVE'),
    /cannot transition from ARCHIVED to ACTIVE/,
  );
});
