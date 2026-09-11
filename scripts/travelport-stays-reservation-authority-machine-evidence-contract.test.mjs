import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('reservation authority public adapter gates canonical selection references before the compatibility core', async () => {
  const provider = await source('src/server/suppliers/travelport-stays-reservation-authority-provider.ts');

  assert.match(provider, /travelport-stays-reservation-authority-provider-core\.ts/);
  assert.match(provider, /assertTravelportStaysPropertyReference\(input\.supplierPropertyReference\)/);
  assert.match(provider, /assertTravelportStaysOfferReference\(input\.supplierOfferReference\)/);
  assert.match(provider, /assertTravelportStaysReservationAuthorityCacheKey\(input\.cacheKey\)/);
  assert.match(provider, /createTravelportStaysReservationAuthorityResponseFetch\(input\.fetchImpl \?\? fetch\)/);
});

test('reservation authority response guard rejects normalization of provider machine evidence', async () => {
  const boundary = await source('src/server/suppliers/travelport-stays-reservation-authority-boundary.ts');

  assert.match(boundary, /ASCII_CONTROL_PATTERN = \/\[\\u0000-\\u001f\\u007f\]\//);
  assert.match(boundary, /value\.trim\(\) !== value/);
  assert.match(boundary, /CURRENCY_CODE_PATTERN = \/\^\[A-Z\]\{3\}\$\//);
  assert.match(boundary, /validateMoneyIfPresent\(record\(price\.totalPrice\)\?\.amount\)/);
  assert.match(boundary, /validateExactMachineStringIfPresent\(paginationIdentifier\.value, MAX_REFERENCE_LENGTH\)/);
  assert.match(boundary, /validateExactMachineStringIfPresent\(identifier\.value, MAX_REFERENCE_LENGTH\)/);
  assert.match(boundary, /validateLocalDateIfPresent\(dateRange\.start\)/);
  assert.match(boundary, /url\.includes\('\/availability\/catalogofferingshospitality'\)/);
});

test('documentation records exact pre-write SearchComplete and Availability authority without enabling reservation', async () => {
  const docs = await source('docs/travelport-reservation-authority-machine-evidence.md');

  assert.match(docs, /SearchComplete/);
  assert.match(docs, /Availability/);
  assert.match(docs, /provider submission reference/i);
  assert.match(docs, /ASCII controls/);
  assert.match(docs, /reservation.*unadvertised/i);
  assert.match(docs, /PCI-safe FormOfPayment\/guarantee source/);
});
