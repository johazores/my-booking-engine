import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

const service = read('src/server/integrations/integration-service.ts');
const page = read('app/integrations/page.tsx');
const docs = read('docs/integration-collection-pagination.md');

test('integration collection service bounds complete and paginated reads', () => {
  assert.match(service, /DEFAULT_INTEGRATION_PAGE_SIZE = 20/);
  assert.match(service, /MAX_INTEGRATION_PAGE_SIZE = 50/);
  assert.match(service, /MAX_COMPLETE_INTEGRATION_ROWS = 1_000/);
  assert.match(service, /export async function listIntegrationsPage/);
  assert.match(service, /const total = await transaction\.integration\.count\(\{ where \}\)/);
  assert.match(service, /skip: \(page - 1\) \* pageSize/);
  assert.match(service, /take: pageSize/);
  assert.match(service, /orderBy: \[\{ providerCode: 'asc' \}, \{ id: 'asc' \}\]/);
  assert.match(service, /take: MAX_COMPLETE_INTEGRATION_ROWS \+ 1/);
  assert.match(service, /integrations\.length > MAX_COMPLETE_INTEGRATION_ROWS/);
  assert.ok((service.match(/isolationLevel: 'RepeatableRead'/g) ?? []).length >= 3);
});

test('integration reads preserve tenant authorization and exact featured-provider identity', () => {
  assert.match(service, /permission: 'integration:read'/);
  assert.match(service, /export async function readIntegrationByProviderCode/);
  assert.match(service, /organizationId_providerCode/);
  assert.match(service, /organizationId: input\.organizationId/);
  assert.match(service, /providerCode = normalizeIntegrationProviderCode\(input\.providerCode\)/);
  assert.match(service, /readIntegrationHealthEvent\(transaction/);
  assert.match(service, /client\.auditEvent\.findFirst/);
  assert.doesNotMatch(service, /db\.auditEvent\.findFirst/);
  assert.match(service, /publicIntegrationRecord/);
});

test('integration page uses exact featured reads plus bounded pagination for other providers', () => {
  assert.doesNotMatch(page, /\blistIntegrations\b/);
  assert.match(page, /readIntegrationByProviderCode/);
  assert.match(page, /listIntegrationsPage/);
  assert.match(page, /INTEGRATION_COLLECTION_PAGE_SIZE = 20/);
  assert.match(page, /providerPage\?: string/);
  assert.match(page, /excludeProviderCodes: FEATURED_PROVIDER_CODES/);
  assert.match(page, /otherIntegrations\.items\.map/);
  assert.match(page, /otherIntegrations\.totalPages > 1/);
  assert.match(page, /aria-label="Other provider pages"/);
});

test('documentation records collection, snapshot, and credential-safety boundaries', () => {
  assert.match(docs, /tenant-owned control-plane records/);
  assert.match(docs, /caps requested page size at 50/);
  assert.match(docs, /encrypted credentials never leave the server credential boundary/);
  assert.match(docs, /fails closed above the 1,000-row complete-read safety limit/);
  assert.match(docs, /RepeatableRead/);
  assert.match(docs, /Current-health derivation is snapshot-consistent/);
});
