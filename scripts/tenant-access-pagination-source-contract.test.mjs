import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

const memberships = read('src/server/memberships/membership-repository.ts');
const organizations = read('src/server/organizations/organization-repository.ts');
const account = read('app/account/page.tsx');
const dashboard = read('app/dashboard/page.tsx');
const docs = read('docs/tenant-access-pagination.md');

test('organization and membership product collections are page-bounded at the repository boundary', () => {
  assert.match(organizations, /MAX_ORGANIZATION_PAGE_SIZE = 50/);
  assert.match(organizations, /listOrganizationsForUserPage/);
  assert.match(organizations, /organization\.count\(\{ where \}\)/);
  assert.match(organizations, /skip: \(page - 1\) \* pageSize/);
  assert.match(organizations, /take: pageSize/);
  assert.match(organizations, /orderBy: \[\{ name: 'asc' \}, \{ id: 'asc' \}\]/);

  assert.match(memberships, /MAX_MEMBERSHIP_PAGE_SIZE = 50/);
  assert.match(memberships, /listMembershipsForOrganizationPage/);
  assert.match(memberships, /organizationMembership\.count\(\{ where \}\)/);
  assert.match(memberships, /skip: \(page - 1\) \* pageSize/);
  assert.match(memberships, /take: pageSize/);
  assert.match(memberships, /orderBy: \[\{ createdAt: 'asc' \}, \{ id: 'asc' \}\]/);
});

test('legacy complete tenant-access readers fail closed instead of remaining unbounded', () => {
  assert.match(organizations, /take: MAX_COMPLETE_ORGANIZATION_ROWS \+ 1/);
  assert.match(organizations, /rows\.length > MAX_COMPLETE_ORGANIZATION_ROWS/);
  assert.match(memberships, /take: MAX_COMPLETE_MEMBERSHIP_ROWS \+ 1/);
  assert.match(memberships, /rows\.length > MAX_COMPLETE_MEMBERSHIP_ROWS/);
});

test('account uses independent server pagination for organizations and members', () => {
  assert.match(account, /listOrganizationsForUserPage/);
  assert.match(account, /listMembershipsForOrganizationPage/);
  assert.match(account, /organizationPage\?: string/);
  assert.match(account, /memberPage\?: string/);
  assert.match(account, /ACCOUNT_COLLECTION_PAGE_SIZE = 20/);
  assert.match(account, /aria-label="Organization pages"/);
  assert.match(account, /aria-label="Organization member pages"/);
  assert.doesNotMatch(account, /listOrganizationsForUser\(/);
  assert.doesNotMatch(account, /listMembershipsForOrganization\(/);
});

test('dashboard reads tenant-scoped aggregate counts without materializing member identities', () => {
  assert.match(memberships, /readOrganizationMembershipStats/);
  assert.match(memberships, /activeTenantOwnedCollectionScope\(input\)/);
  assert.match(dashboard, /readOrganizationMembershipStats/);
  assert.doesNotMatch(dashboard, /listMembershipsForOrganization/);
  assert.doesNotMatch(dashboard, /\.filter\(\(membership\)/);
});

test('documentation preserves tenant authority while defining bounded collection behavior', () => {
  assert.match(docs, /activeOrganizationMembershipScope/);
  assert.match(docs, /activeTenantOwnedCollectionScope/);
  assert.match(docs, /fails closed above 1,000 rows/);
  assert.match(docs, /Page-size ceilings are repository rules/);
});
