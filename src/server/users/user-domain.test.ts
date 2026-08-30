import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertUserStatusTransition,
  canTransitionUserStatus,
  createCanonicalUserEmail,
  normalizeUserEmail,
  validateUserEmail,
} from './user-domain.ts';

test('normalizes user emails deterministically', () => {
  assert.equal(normalizeUserEmail('  Owner@Example.COM  '), 'owner@example.com');
});

test('accepts only canonical valid user emails', () => {
  assert.equal(validateUserEmail('owner@example.com'), true);
  assert.equal(validateUserEmail('Owner@example.com'), false);
  assert.equal(validateUserEmail(' owner@example.com '), false);
  assert.equal(validateUserEmail('owner@example'), false);
  assert.equal(validateUserEmail('owner @example.com'), false);
});

test('creates canonical user emails and rejects invalid values', () => {
  assert.equal(createCanonicalUserEmail(' Owner@Example.COM '), 'owner@example.com');
  assert.throws(() => createCanonicalUserEmail('not-an-email'), /valid canonical email/);
});

test('enforces explicit user lifecycle transitions', () => {
  assert.equal(canTransitionUserStatus('ACTIVE', 'SUSPENDED'), true);
  assert.equal(canTransitionUserStatus('SUSPENDED', 'ACTIVE'), true);
  assert.equal(canTransitionUserStatus('ACTIVE', 'ARCHIVED'), true);
  assert.equal(canTransitionUserStatus('ARCHIVED', 'ACTIVE'), false);
  assert.throws(
    () => assertUserStatusTransition('ARCHIVED', 'ACTIVE'),
    /cannot transition/,
  );
});
