import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('Travelport Create stays strict while Retrieve counts one active hospitality segment for the durable single-room stay', async () => {
  const create = await source('src/server/suppliers/travelport-stays-reservation-create-outcome.ts');
  const retrieve = await source('src/server/suppliers/travelport-stays-reservation-response.ts');

  assert.match(create, /let hospitalitySegments = 0/);
  assert.match(create, /hospitalitySegments \+= 1/);
  assert.match(create, /offerEvidence\.hospitalitySegments === 1 && offerEvidence\.matches === 1/);
  assert.doesNotMatch(create, /if \(passiveOfferInd === true\) continue/);

  assert.match(retrieve, /let activeHospitalitySegments = 0/);
  assert.match(retrieve, /activeHospitalitySegments \+= 1/);
  assert.match(retrieve, /const passiveOfferInd = offer\.passiveOfferInd/);
  assert.match(retrieve, /typeof passiveOfferInd !== 'boolean'/);
  assert.match(retrieve, /if \(passiveOfferInd === true\) continue/);
  assert.match(retrieve, /activeHospitalitySegments !== 1 \|\| matches !== 1/);
});

test('Travelport segment evidence remains scoped to ProductHospitality so multi-content PNRs are not rejected merely for air or car content', async () => {
  const create = await source('src/server/suppliers/travelport-stays-reservation-create-outcome.ts');
  const retrieve = await source('src/server/suppliers/travelport-stays-reservation-response.ts');

  assert.match(create, /product\['@type'\] !== 'ProductHospitality'\) continue/);
  assert.match(retrieve, /product\['@type'\] !== 'ProductHospitality'\) continue/);
});
