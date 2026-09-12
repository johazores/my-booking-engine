import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('shared reservation expectation establishes a one-read frozen authority snapshot', async () => {
  const identity = await source('src/server/suppliers/travelport-stays-reservation-identity.ts');
  assert.match(identity, /function materializeReservationExpectationInput/);
  for (const [field, localName] of [
    ['supplierPropertyReference', 'supplierPropertyReference'],
    ['arrivalDateLocal', 'arrivalDateLocal'],
    ['departureDateLocal', 'departureDateLocal'],
    ['rooms', 'rooms'],
    ['adults', 'adults'],
    ['childAges', 'childAgesValue'],
  ]) {
    assert.match(identity, new RegExp(`${localName}: input\\.${field},`));
  }
  assert.match(identity, /Object\.freeze\(\[\.\.\.\(values\.childAgesValue as unknown\[\]\)\]\)/);
  assert.match(identity, /return Object\.freeze\(\{[\s\S]*?supplierPropertyReference: values\.supplierPropertyReference,[\s\S]*?childAges,[\s\S]*?\}\);/);
  assert.match(identity, /const authority = materializeReservationExpectationInput\(input\);/);
  assert.doesNotMatch(identity, /const property = decodeTravelportStaysPropertyReference\(input\.supplierPropertyReference\)/);
});

test('reservation expectation materialization fails closed without caller exception leakage', async () => {
  const identity = await source('src/server/suppliers/travelport-stays-reservation-identity.ts');
  const helperStart = identity.indexOf('function safelyMaterialize');
  const materializerStart = identity.indexOf('function materializeReservationExpectationInput');
  assert.ok(helperStart >= 0 && materializerStart > helperStart);
  const helper = identity.slice(helperStart, materializerStart);
  assert.match(helper, /catch \{\s*invalidRequest\('Expected reservation evidence could not be materialized safely\.'\);\s*\}/);
  assert.doesNotMatch(helper, /throw error|instanceof HospitalitySupplierProviderError/);
  assert.match(identity, /const adults = authority\.adults;/);
  assert.match(identity, /const childAges = authority\.childAges;/);
  assert.doesNotMatch(identity, /input\.adults as number/);
});

test('documentation records shared reservation scope and preserves activation gates', async () => {
  const docs = await source('docs/travelport-stays-reservation-expectation-authority.md');
  assert.match(docs, /Create, reviewed Create, Booking\.com Sync, and known-locator recovery/);
  assert.match(docs, /shared normalizer is used by initial Create, reviewed Create, Booking\.com Sync coordination, and known-locator recovery/);
  assert.match(docs, /does not enable the Travelport `reservation` capability/);
  assert.match(docs, /PCI-safe FormOfPayment\/guarantee source/);
  assert.match(docs, /`13034` \/ locator-less correlation and retry semantics/);
});
