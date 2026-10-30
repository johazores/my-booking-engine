import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertUserStatusTransition,
  canTransitionUserStatus,
  createCanonicalUserEmail,
  hasUnsafeIdentityControls,
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

test('identity email validation rejects hidden controls without restricting ordinary Unicode', () => {
  assert.equal(hasUnsafeIdentityControls('a\u0000b'), true);
  assert.equal(hasUnsafeIdentityControls('a\u202eb'), true);
  assert.equal(hasUnsafeIdentityControls('Renée 李 🐈'), false);
  assert.equal(hasUnsafeIdentityControls('أحمد नमस्ते'), false);
  // Preserve ordinary Unicode while denying hidden formatting and bidi marks.
  for (const hidden of ['\u00ad', '\u061c', '\u180e', '\u200e', '\u200f', '\u2061', '\u206a', '\u206f', '\u034f', '\u200c', '\u200d', '\ufe0f', '\u3164', '\u{e0001}', '\u{e0100}']) {
    assert.equal(hasUnsafeIdentityControls('a' + hidden + 'b'), true);
  }
  for (const email of ['a\u0000b@example.test', 'a\u0085b@example.test', 'a\u202eb@example.test', 'a\ud800@example.test', 'a\u200bb@example.test', 'a\ufeffb@example.test', 'a\u200eb@example.test', 'a\u061cb@example.test', 'a\u00adb@example.test', 'a\u206fb@example.test', 'a\u034fb@example.test', 'a\u200cb@example.test', 'a\u{e0001}b@example.test']) {
    assert.equal(validateUserEmail(email), false);
    assert.throws(() => createCanonicalUserEmail(email), /valid canonical email/);
  }
  assert.equal(validateUserEmail(null as unknown as string), false);
  assert.throws(() => createCanonicalUserEmail(null as unknown as string), /valid canonical email/);
  assert.throws(() => createCanonicalUserEmail('\ufeffuser@example.test'), /valid canonical email/);
  assert.throws(() => createCanonicalUserEmail('\nuser@example.test'), /valid canonical email/);
});
