import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const schema = read('prisma/rental-late-return-policy.prisma');
const assessmentSchema = read('prisma/rental-late-return.prisma');
const migration = read('prisma/migrations/20260918002500_rental_late_return_policy/migration.sql');
const parentLifecycleMigration = read('prisma/migrations/20260919222000-rental-late-return-policy-parent-authority/migration.sql');
const policyService = read('src/server/pricing/rental-late-return-policy-service.ts');
const policyDomain = read('src/server/pricing/rental-late-return-policy-domain.ts');
const assessmentService = read('src/server/bookings/rental-late-return-service.ts');
const assessmentDomain = read('src/server/bookings/rental-late-return-domain.ts');
const policyPanel = read('src/components/rental-late-return-policy-panel.tsx');
const assessmentPanel = read('src/components/rental-late-return-assessment-panel.tsx');
const policyRoute = read('app/api/inventory/rentals/unit-types/[unit-type-id]/late-return-policy/route.ts');
const unitTypePage = read('app/inventory/rentals/types/[unit-type-id]/page.tsx');
const docs = read('docs/rental-late-return-policy.md');

test('policy revisions are tenant-owned, versioned, append-only commercial authority', () => {
  assert.match(schema, /model RentalLateReturnPolicyRevision/);
  assert.match(schema, /organizationId\s+String\s+@db\.Uuid/);
  assert.match(schema, /unitTypeId\s+String\s+@db\.Uuid/);
  assert.match(schema, /version\s+Int/);
  assert.match(schema, /dailyFeeMinor\s+BigInt\?/);
  assert.match(schema, /@@unique\(\[organizationId, unitTypeId, version\]/);
  assert.match(assessmentSchema, /policyRevisionId\s+String\?\s+@db\.Uuid/);
  assert.match(assessmentSchema, /policyDailyFeeMinor\s+BigInt\?/);
  assert.match(migration, /rental late-return policy revisions are append-only/);
  assert.match(migration, /sf:rental-late-return-policy:/);
  assert.match(migration, /unit_type_status <> 'ACTIVE'/);
  assert.match(migration, /NEW\."version" <> next_version/);
  assert.match(migration, /NEW\."currency" <> unit_type_currency/);
  assert.match(migration, /NEW\."dailyFeeMinor" > 9000000000000000/);
  assert.match(migration, /clock_timestamp\(\)/);
});

test('policy writes serialize parent lifecycle before policy-version authority', () => {
  const parentLock = policyService.indexOf('rentalUnitTypeLifecycleLockKey(input.organizationId, input.unitTypeId)');
  const policyLock = policyService.indexOf('rentalLateReturnPolicyLockKey(input.organizationId, input.unitTypeId)');
  const activeParentRead = policyService.indexOf("status: 'ACTIVE'", policyLock);
  const revisionCreate = policyService.indexOf('rentalLateReturnPolicyRevision.create', activeParentRead);

  assert.ok(parentLock >= 0, 'shared unit-type lifecycle lock');
  assert.ok(policyLock > parentLock, 'policy lock follows parent lifecycle lock');
  assert.ok(activeParentRead > policyLock, 'active unit type is re-read after both locks');
  assert.ok(revisionCreate > activeParentRead, 'revision is authored only after active parent revalidation');

  assert.match(parentLifecycleMigration, /sf_lock_rental_unit_type_lifecycle\(NEW\."organizationId", NEW\."unitTypeId"\)/);
  assert.match(parentLifecycleMigration, /unit_type\."organizationId" = NEW\."organizationId"/);
  assert.match(parentLifecycleMigration, /parent_status <> 'ACTIVE'/);
  assert.match(parentLifecycleMigration, /CREATE TRIGGER a_rental_late_return_policy_parent_lifecycle_guard/);
  assert.match(parentLifecycleMigration, /BEFORE INSERT ON "rental_late_return_policy_revisions"/);
});

test('policy service enforces permissions, tenant scope, optimistic versioning, retries, and audit', () => {
  for (const evidence of [
    "permission: 'inventory:read'",
    "permission: 'pricing:read'",
    "permission: 'pricing:manage'",
    'organizationId: input.organizationId',
    'rentalUnitTypeLifecycleLockKey(input.organizationId, input.unitTypeId)',
    'rentalLateReturnPolicyLockKey(input.organizationId, input.unitTypeId)',
    "isolationLevel: 'Serializable'",
    'requested.expectedVersion + 1',
    'rentalLateReturnPolicyMatches',
    "action: requested.enabled",
    "'pricing.rental.late-return-policy.enabled'",
    "'pricing.rental.late-return-policy.disabled'",
  ]) assert.ok(policyService.includes(evidence), evidence);
  assert.match(policyDomain, /parseMoneyMajorToMinor/);
  assert.match(policyDomain, /dailyFeeMinor <= 0n/);
  assert.match(policyDomain, /graceDays < 0 \|\| graceDays > 30/);
});

test('assessment binds to the latest policy already effective at immutable return time', () => {
  for (const evidence of [
    'unitTypeId: booking.unitTypeId',
    'effectiveAt: { lte: returnEvent.occurredAt }',
    "orderBy: [{ effectiveAt: 'desc' }, { version: 'desc' }, { id: 'desc' }]",
    'policyRevisionId: normalized.policyRevisionId',
    'policyDailyFeeMinor: normalized.policyDailyFeeMinor',
  ]) assert.ok(assessmentService.includes(evidence), evidence);
  assert.match(assessmentDomain, /policy\.dailyFeeMinor \* BigInt\(timing\.chargeableDays\)/);
  assert.match(assessmentDomain, /cannot be overridden/);

  assert.match(migration, /policy\."effectiveAt" <= return_occurred_at/);
  assert.match(migration, /NEW\."policyRevisionId" IS DISTINCT FROM latest_policy_id/);
  assert.match(migration, /NEW\."graceDays" <> latest_policy_grace_days/);
  assert.match(migration, /NEW\."feeMinor"::NUMERIC <> \(NEW\."chargeableDays"::NUMERIC \* latest_policy_daily_fee_minor::NUMERIC\)/);
  assert.match(migration, /9000000000000000/);
  assert.match(migration, /manual late-return assessment cannot claim inactive policy authority/);
});

test('staff policy configuration and assessment UI are connected to real server-backed routes', () => {
  assert.match(unitTypePage, /RentalLateReturnPolicyPanel/);
  assert.match(policyPanel, /Late-return fee policy/);
  assert.match(policyPanel, /Save new policy revision/);
  assert.match(policyPanel, /Disable policy/);
  assert.match(policyRoute, /prepareInventoryMutationRequest/);
  assert.match(policyRoute, /reviseRentalLateReturnPolicy/);
  assert.match(policyRoute, /formField\(formData, 'expectedVersion'\)/);
  assert.match(assessmentPanel, /Automatic policy revision/);
  assert.match(assessmentPanel, /cannot be overridden by the browser/);
  assert.match(assessmentPanel, /Apply policy fee/);
});

test('documentation states parent serialization, non-retroactive automatic math, and separate settlement', () => {
  assert.match(docs, /shared rental unit-type lifecycle lock is acquired first/i);
  assert.match(docs, /archived unit types cannot receive new revisions/i);
  assert.match(docs, /non-retroactive/i);
  assert.match(docs, /latest policy revision whose `effectiveAt` is on or before/i);
  assert.match(docs, /feeMinor = chargeableDays \* policyDailyFeeMinor/);
  assert.match(docs, /does not charge a card/i);
  assert.match(docs, /Settlement remains a separate evidence boundary/i);
});
