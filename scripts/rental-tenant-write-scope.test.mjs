import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('rental inventory mutations repeat tenant scope in every update and delete predicate', () => {
  const service = source('src/server/inventory/rental-service.ts');

  assert.match(service, /permission: 'inventory:manage'/);
  assert.match(
    service,
    /rentalUnit\.update\(\{\s*where: \{ id: unit\.id, organizationId: input\.organizationId \},\s*data: \{ locationId: location\.id \}/,
  );
  assert.match(
    service,
    /rentalLocation\.update\(\{\s*where: \{ id: current\.id, organizationId: input\.organizationId \},\s*data: \{ status: 'ARCHIVED', archivedAt \}/,
  );
  assert.match(
    service,
    /rentalUnitType\.update\(\{\s*where: \{ id: current\.id, organizationId: input\.organizationId \},\s*data: \{ status: 'ARCHIVED', archivedAt \}/,
  );
  assert.match(
    service,
    /rentalUnit\.update\(\{\s*where: \{ id: current\.id, organizationId: input\.organizationId \},\s*data: \{ status: 'ARCHIVED', archivedAt \}/,
  );
  assert.match(
    service,
    /rentalAvailabilityBlock\.delete\(\{\s*where: \{ id: current\.id, organizationId: input\.organizationId \}/,
  );
  assert.match(
    service,
    /rentalRatePeriod\.delete\(\{\s*where: \{ id: current\.id, organizationId: input\.organizationId \}/,
  );

  assert.doesNotMatch(service, /rentalUnit\.update\(\{ where: \{ id: unit\.id \}/);
  assert.doesNotMatch(service, /rentalLocation\.update\(\{ where: \{ id: current\.id \}/);
  assert.doesNotMatch(service, /rentalUnitType\.update\(\{ where: \{ id: current\.id \}/);
  assert.doesNotMatch(service, /rentalUnit\.update\(\{ where: \{ id: current\.id \}/);
  assert.doesNotMatch(service, /rentalAvailabilityBlock\.delete\(\{ where: \{ id: current\.id \}/);
  assert.doesNotMatch(service, /rentalRatePeriod\.delete\(\{ where: \{ id: current\.id \}/);
});

test('rental hold lifecycle write remains tenant-scoped', () => {
  const service = source('src/server/inventory/rental-hold-service.ts');

  assert.match(service, /permission: 'availability:manage'/);
  assert.match(
    service,
    /rentalAvailabilityHold\.updateMany\(\{\s*where: \{\s*id: current\.id,\s*organizationId: input\.organizationId,\s*status: 'ACTIVE'/,
  );
  assert.match(
    service,
    /rentalAvailabilityHold\.findFirstOrThrow\(\{\s*where: \{\s*id: current\.id,\s*organizationId: input\.organizationId/,
  );
});

test('rental tenant write-scope documentation records the production invariant', () => {
  const document = source('docs/rental-tenant-write-scope.md');

  assert.match(document, /every update and delete repeats the authenticated organization ID/i);
  assert.match(document, /inventory:manage/i);
  assert.match(document, /availability:manage/i);
  assert.match(document, /tenant-scoped read does not replace write-time tenant scope/i);
  assert.match(document, /serializable/i);
  assert.match(document, /no GitHub Actions/i);
});
