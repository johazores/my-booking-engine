import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('reservation authority successful provider responses fail closed before compatibility parsing', async () => {
  const boundary = await source('src/server/suppliers/travelport-stays-reservation-authority-boundary.ts');
  const payloadIndex = boundary.indexOf('const payload = await response.clone().json()');
  const jsonFailureIndex = boundary.indexOf('Travelport reservation authority response is not valid JSON.', payloadIndex);
  const searchValidationIndex = boundary.indexOf("if (requestAuthority.kind === 'search-complete')", payloadIndex);

  assert.ok(payloadIndex >= 0);
  assert.ok(jsonFailureIndex > payloadIndex);
  assert.ok(searchValidationIndex > jsonFailureIndex);
  assert.match(boundary, /Travelport reservation SearchComplete response envelope is invalid\./);
  assert.match(boundary, /Travelport reservation Availability response envelope is invalid\./);
});

test('reservation authority SearchComplete binds exact one-property page authority', async () => {
  const boundary = await source('src/server/suppliers/travelport-stays-reservation-authority-boundary.ts');

  assert.match(boundary, /pagination\.page !== 1/);
  assert.match(boundary, /pagination\.pageSize !== MAX_SEARCH_PROPERTIES/);
  assert.match(boundary, /pagination\.totalPages !== 1/);
  assert.match(boundary, /pagination\.totalItems !== MAX_SEARCH_PROPERTIES/);
  assert.match(boundary, /pagination\.paginationToken !== undefined/);
  assert.match(boundary, /properties\.length !== MAX_SEARCH_PROPERTIES/);
});

test('reservation authority envelope documentation keeps the supplier write disabled', async () => {
  const docs = await source('docs/travelport-reservation-authority-machine-evidence.md');

  assert.match(docs, /Successful reservation-authority responses must parse as JSON/i);
  assert.match(docs, /pagination\.page.*must be `1`/i);
  assert.match(docs, /CatalogOfferingsHospitalityResponse\.CatalogOfferings/);
  assert.match(docs, /reservation.*remains deliberately unadvertised/i);
  assert.match(docs, /PCI-safe FormOfPayment\/guarantee source/);
  assert.match(docs, /13034/);
});
