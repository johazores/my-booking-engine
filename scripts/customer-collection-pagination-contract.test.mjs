import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const repository = readFileSync('src/server/customers/customer-repository.ts', 'utf8');
const docs = readFileSync('docs/customer-collection-pagination.md', 'utf8');

test('customer list bounds page and page size inside the repository', () => {
  assert.match(repository, /function normalizeCustomerPagination/);
  assert.match(repository, /Number\.isSafeInteger\(pageInput\) && pageInput > 0 \? pageInput : 1/);
  assert.match(repository, /Math\.min\(pageSizeInput, CUSTOMER_PAGE_SIZE_MAX\)/);
  assert.match(repository, /: CUSTOMER_PAGE_SIZE_DEFAULT/);
  assert.match(repository, /take: pagination\.pageSize/);
  assert.doesNotMatch(repository, /take: input\.pageSize/);
  assert.match(repository, /pageSize: pagination\.pageSize/);
});

test('customer list keeps tenant scope and deterministic sort authority', () => {
  assert.match(repository, /organizationId: input\.organizationId/);
  assert.match(repository, /const total = await db\.customer\.count\(\{ where \}\)/);
  assert.match(repository, /orderBy: customerOrderBy\(input\.sort\)/);
  assert.match(repository, /const page = Math\.min\(pagination\.page, totalPages\)/);
});

test('customer activity remains independently bounded', () => {
  assert.match(repository, /take: Math\.min\(Math\.max\(input\.limit \?\? 30, 1\), 100\)/);
  assert.match(repository, /resourceId: input\.customerId/);
});

test('documentation records repository-level defense in depth', () => {
  assert.match(docs, /page sizes are capped at 50/);
  assert.match(docs, /tenant\/status\/search scope is identical/);
  assert.match(docs, /repository callers cannot bypass collection limits/);
});
