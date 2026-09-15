import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = fs.readFileSync(path.join(root, 'src/server/integrations/integration-service.ts'), 'utf8');
const document = fs.readFileSync(path.join(root, 'docs/integration-write-scope.md'), 'utf8');

function integrationUpdateWhereBlocks(text) {
  const pattern = /integration\.update\(\{\s*where:\s*\{([\s\S]*?)\n\s*\},\s*data:/g;
  return [...text.matchAll(pattern)].map((match) => match[1]);
}

function assertFields(block, fields, label) {
  for (const field of fields) {
    assert.match(block, new RegExp(`\\b${field}\\b`), `${label} must retain ${field}`);
  }
}

test('every production integration mutation retains tenant, provider, lifecycle, and credential snapshot', () => {
  const blocks = integrationUpdateWhereBlocks(source);
  assert.equal(blocks.length, 4);
  for (const [index, block] of blocks.entries()) {
    assertFields(block, ['id', 'organizationId', 'providerCode', 'status', 'credentialVersion'], `integration mutation ${index + 1}`);
    assert.match(block, /organizationId:\s*input\.organizationId/);
    assert.match(block, /providerCode:\s*existing\.providerCode/);
    assert.match(block, /status:\s*existing\.status/);
    assert.match(block, /credentialVersion:\s*existing\.credentialVersion/);
  }
  assert.doesNotMatch(source, /integration\.update\(\{\s*where:\s*\{\s*id:\s*existing\.id\s*\},/);
});

test('management mutations use serializable transactions and fail closed on persistence races', () => {
  assert.equal((source.match(/isolationLevel:\s*'Serializable'/g) ?? []).length, 4);
  assert.match(source, /class IntegrationWriteConflictError extends IntegrationLifecycleError/);
  assert.match(source, /code === 'P2002'/);
  assert.match(source, /code === 'P2025'/);
  assert.match(source, /code === 'P2034'/);
  assert.match(source, /runIntegrationWrite\(\(\) => db\.\$transaction/g);
});

test('authorization, tenant reads, lifecycle rules, and secret handling remain explicit', () => {
  assert.equal((source.match(/permission:\s*'integration:manage'/g) ?? []).length, 4);
  assert.match(source, /organizationId_providerCode:\s*\{ organizationId: input\.organizationId, providerCode \}/);
  assert.match(source, /where:\s*\{ id: input\.integrationId, organizationId: input\.organizationId \}/);
  assert.match(source, /Archived integrations require fresh credentials/);
  assert.match(source, /Archived integrations cannot change lifecycle state/);
  assert.match(source, /Disable the integration before archiving it/);
  assert.match(source, /encryptedCredentials:\s*null/);
  assert.match(source, /decryptIntegrationCredentials\(integration\.encryptedCredentials\)/);
});

test('write-scope documentation records the concurrency and tenant guarantees', () => {
  assert.match(document, /Final-write authority/);
  assert.match(document, /organizationId/);
  assert.match(document, /credential version/i);
  assert.match(document, /serializable/i);
  assert.match(document, /IntegrationWriteConflictError/);
  assert.match(document, /Similar-issue sweep/);
  assert.match(document, /encrypted credential envelope/);
  assert.match(document, /GitHub Actions are intentionally not used/);
});
