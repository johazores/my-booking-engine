import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertOrganizationStatusTransition,
  canTransitionOrganizationStatus,
  createOrganizationSlug,
  normalizeOrganizationSlug,
  validateOrganizationSlug,
} from './organization-domain.ts';

test('normalizes organization slugs deterministically', () => {
  assert.equal(normalizeOrganizationSlug('  SF Beach Resort  '), 'sf-beach-resort');
  assert.equal(normalizeOrganizationSlug('SF___Travel!!!Agency'), 'sf-travel-agency');
});

test('accepts only canonical organization slugs', () => {
  assert.equal(validateOrganizationSlug('sf-resort'), true);
  assert.equal(validateOrganizationSlug('SF-Resort'), false);
  assert.equal(validateOrganizationSlug('-sf-resort'), false);
  assert.equal(validateOrganizationSlug('ab'), false);
});

test('creates a canonical slug or rejects an unusable identifier', () => {
  assert.equal(createOrganizationSlug('SF Manila Hotel'), 'sf-manila-hotel');
  assert.throws(() => createOrganizationSlug('@@'), /Organization slug must be/);
});

test('enforces organization lifecycle transitions', () => {
  assert.equal(canTransitionOrganizationStatus('ACTIVE', 'SUSPENDED'), true);
  assert.equal(canTransitionOrganizationStatus('SUSPENDED', 'ACTIVE'), true);
  assert.equal(canTransitionOrganizationStatus('ACTIVE', 'ARCHIVED'), true);
  assert.equal(canTransitionOrganizationStatus('ARCHIVED', 'ACTIVE'), false);
  assert.throws(
    () => assertOrganizationStatusTransition('ARCHIVED', 'ACTIVE'),
    /cannot transition/,
  );
});
