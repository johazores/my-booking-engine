import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');
const pricing = read('src/server/pricing/hospitality-pricing-service.ts');
const scopes = read('src/server/pricing/hospitality-pricing-scope-service.ts');
const charges = read('src/server/pricing/hospitality-charge-service.ts');
const addons = read('src/server/pricing/hospitality-addon-service.ts');
const docs = read('docs/hospitality-pricing-read-consistency.md');

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing source section: ${start}`);
  const endIndex = end ? source.indexOf(end, startIndex + start.length) : source.length;
  assert.notEqual(endIndex, -1, `Missing source section terminator: ${end}`);
  return source.slice(startIndex, endIndex);
}

function assertSnapshotCollection(source, model, orderByPattern) {
  assert.match(source, /permission: 'pricing:read'/);
  assert.match(source, /normalizePricingPagination\(input\.page, input\.pageSize\)/);
  assert.match(source, /db\.\$transaction\(async \(transaction\) =>/);
  assert.match(source, new RegExp(`transaction\\.${model}\\.count\\(\\{ where \\}\\)`));
  assert.match(source, new RegExp(`transaction\\.${model}\\.findMany`));
  assert.match(source, /const totalPages = Math\.max\(1, Math\.ceil\(total \/ pagination\.pageSize\)\)/);
  assert.match(source, /const page = Math\.min\(pagination\.page, totalPages\)/);
  assert.match(source, /skip: \(page - 1\) \* pagination\.pageSize/);
  assert.match(source, /take: pagination\.pageSize/);
  assert.match(source, orderByPattern);
  assert.match(source, /isolationLevel: 'RepeatableRead'/);
  assert.doesNotMatch(source, new RegExp(`await db\\.${model}\\.(?:count|findMany)`));
}

test('pricing scope management count and rows share one tenant-property snapshot', () => {
  const source = section(scopes, 'export async function listHospitalityPricingScopes', 'export async function readHospitalityPricingScope');
  assert.match(source, /organizationId: input\.organizationId/);
  assert.match(source, /propertyId: input\.propertyId/);
  assert.match(source, /roomType: \{ status: 'ACTIVE' as const \}/);
  assert.match(source, /ratePlan: \{ status: 'ACTIVE' as const \}/);
  assertSnapshotCollection(source, 'hospitalityRoomTypeRatePlan', /orderBy: \[\{ createdAt: 'asc' \}, \{ roomTypeId: 'asc' \}, \{ ratePlanId: 'asc' \}\]/);
});

test('base-rate management count and rows share one exact pricing-scope snapshot', () => {
  const source = section(pricing, 'export async function listHospitalityBaseRates', 'export async function createHospitalityBaseRate');
  assert.match(source, /organizationId: input\.organizationId/);
  assert.match(source, /propertyId: input\.propertyId/);
  assert.match(source, /roomTypeId: input\.roomTypeId/);
  assert.match(source, /ratePlanId: input\.ratePlanId/);
  assertSnapshotCollection(source, 'hospitalityBaseRate', /orderBy: \[\{ status: 'asc' \}, \{ startDate: 'desc' \}, \{ id: 'asc' \}\]/);
});

test('charge-rule management count and rows share one tenant-property snapshot', () => {
  const source = section(charges, 'export async function listHospitalityChargeRules', 'export async function createHospitalityChargeRule');
  assert.match(source, /organizationId: input\.organizationId/);
  assert.match(source, /propertyId: input\.propertyId/);
  assertSnapshotCollection(source, 'hospitalityChargeRule', /orderBy: \[\{ status: 'asc' \}, \{ kind: 'asc' \}, \{ name: 'asc' \}, \{ startDate: 'desc' \}, \{ id: 'asc' \}\]/);
});

test('add-on management count and rows share one tenant-property snapshot', () => {
  const source = section(addons, 'export async function listHospitalityAddons', 'export async function createHospitalityAddon');
  assert.match(source, /organizationId: input\.organizationId/);
  assert.match(source, /propertyId: input\.propertyId/);
  assertSnapshotCollection(source, 'hospitalityAddon', /orderBy: \[\{ status: 'asc' \}, \{ name: 'asc' \}, \{ startDate: 'desc' \}, \{ id: 'asc' \}\]/);
});

test('documentation keeps presentation snapshots separate from commercial completeness', () => {
  assert.match(docs, /RepeatableRead/);
  assert.match(docs, /maximum page size of 50/);
  assert.match(docs, /organizationId/);
  assert.match(docs, /Commercial pricing authority is separate/);
  assert.match(docs, /paginated management page never proves/);
  assert.match(docs, /must not reuse these paginated readers as completeness evidence/);
});
