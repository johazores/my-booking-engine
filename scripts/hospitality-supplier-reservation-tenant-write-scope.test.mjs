import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function updateBlocks(sourceText, modelName) {
  const pattern = new RegExp(`hospitalitySupplierReservation${modelName}\\.update\\(\\{([\\s\\S]*?)\\n\\s*data: \\{`, 'g');
  return [...sourceText.matchAll(pattern)].map((match) => match[1] ?? '');
}

function assertTenantScopedUpdates(sourceText, modelName, expectedCount) {
  const blocks = updateBlocks(sourceText, modelName);
  assert.equal(blocks.length, expectedCount, `expected ${expectedCount} ${modelName.toLowerCase()} updates`);
  for (const block of blocks) {
    assert.match(
      block,
      /where:\s*\{\s*id:\s*(?:reservation|attempt)\.id,\s*organizationId:\s*input\.organizationId\s*\}/,
      `${modelName} update must repeat organizationId in the write predicate`,
    );
  }
}

test('supplier reservation lifecycle writes repeat tenant scope after authorization and scoped reads', () => {
  const service = source('src/server/suppliers/hospitality-supplier-reservation-service.ts');
  assert.match(service, /permission: 'booking:manage'/);
  assert.match(service, /where: \{ id: input\.reservationId, organizationId: input\.organizationId \}/);
  assertTenantScopedUpdates(service, 'Operation', 4);
  assertTenantScopedUpdates(service, 'Attempt', 2);
});

test('stale supplier attempt recovery repeats tenant scope on both durable writes', () => {
  const service = source('src/server/suppliers/hospitality-supplier-reservation-attempt-recovery-service.ts');
  assert.match(service, /permission: 'booking:manage'/);
  assert.match(service, /id: input\.reservationId,[\s\S]*?organizationId: input\.organizationId/);
  assertTenantScopedUpdates(service, 'Operation', 1);
  assertTenantScopedUpdates(service, 'Attempt', 1);
});

test('supplier tenant-write documentation keeps write-time scope as an explicit invariant', () => {
  const document = source('docs/supplier-reservation-tenant-write-scope.md');
  assert.match(document, /every mutable operation and attempt update repeats the organization ID/i);
  assert.match(document, /booking:manage/i);
  assert.match(document, /does not replace tenant scope on the write/i);
  assert.match(document, /serializable transaction/i);
  assert.match(document, /no GitHub Actions/i);
});
