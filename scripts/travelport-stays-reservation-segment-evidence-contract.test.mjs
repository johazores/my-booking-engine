import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('Travelport Create and Retrieve reject malformed active offer structure while preserving their distinct passive semantics', async () => {
  const create = await source('src/server/suppliers/travelport-stays-reservation-create-outcome.ts');
  const retrieve = await source('src/server/suppliers/travelport-stays-reservation-response.ts');

  assert.match(create, /function invalidOfferEvidence\(\)/);
  assert.match(create, /if \(!offer\) return invalidOfferEvidence\(\)/);
  assert.match(create, /products\.length < 1 \|\| products\.length > MAX_PRODUCTS_PER_OFFER/);
  assert.match(create, /if \(!product \|\| !productType\) return invalidOfferEvidence\(\)/);
  assert.match(create, /offerEvidence\.valid[\s\S]*?offerEvidence\.hospitalitySegments === 1[\s\S]*?offerEvidence\.matches === 1/);
  assert.doesNotMatch(create, /if \(passiveOfferInd === true\) continue/);

  assert.match(retrieve, /const offer = record\(offerValue\)/);
  assert.match(retrieve, /const passiveOfferInd = offer\.passiveOfferInd/);
  assert.match(retrieve, /typeof passiveOfferInd !== 'boolean'/);
  const passiveSkip = retrieve.indexOf('if (passiveOfferInd === true) continue');
  const productInspection = retrieve.indexOf('const products = offer.Product');
  assert.ok(passiveSkip >= 0 && productInspection > passiveSkip, 'explicit passive placeholders must be excluded before their incomplete product body is inspected');
  assert.match(retrieve, /products\.length < 1 \|\| products\.length > MAX_PRODUCTS_PER_OFFER/);
  assert.match(retrieve, /const product = record\(productValue\)/);
  assert.match(retrieve, /if \(!productType\)/);
  assert.match(retrieve, /activeHospitalitySegments !== 1 \|\| matches !== 1/);
});

test('Travelport segment evidence remains scoped to well-formed ProductHospitality so valid multi-content PNRs keep working', async () => {
  const create = await source('src/server/suppliers/travelport-stays-reservation-create-outcome.ts');
  const retrieve = await source('src/server/suppliers/travelport-stays-reservation-response.ts');

  assert.match(create, /if \(productType !== 'ProductHospitality'\) continue/);
  assert.match(retrieve, /if \(productType !== 'ProductHospitality'\) continue/);
});
