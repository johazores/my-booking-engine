import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('Travelport retrieve keeps one privacy-minimal reservation response authority parser', async () => {
  const parser = await source('src/server/suppliers/travelport-stays-reservation-response.ts');
  const recovery = await source('src/server/suppliers/travelport-stays-reservation-recovery-provider.ts');

  assert.match(recovery, /parseTravelportStaysReservationResponse/);
  assert.match(recovery, /expectedProviderReservationReference: reference/);
  assert.doesNotMatch(recovery, /function parseReservationResponse/);

  assert.match(parser, /providerReservationReference/);
  assert.match(parser, /supplierConfirmationReference/);
  assert.match(parser, /providerCorrelationId/);
  assert.match(parser, /root\.ErrorResponse !== undefined/);
  assert.doesNotMatch(parser, /root\.ErrorResponse !== undefined && root\.ErrorResponse !== null/);
  assert.match(parser, /contradictory top-level error evidence/);
  assert.match(parser, /const reservationType = boundedProviderValue\(reservation\['@type'\], MAX_RESERVATION_TYPE_LENGTH\)/);
  assert.match(parser, /if \(reservationType !== 'ReservationDetail'\)/);
  assert.match(parser, /unexpected reservation type evidence/);
  assert.match(parser, /const offerType = boundedProviderValue\(offer\['@type'\], MAX_OFFER_TYPE_LENGTH\)/);
  assert.match(parser, /if \(offerType !== 'Offer'\)/);
  assert.match(parser, /const offerId = boundedProviderValue\(offer\.id, MAX_OFFER_REFERENCE_LENGTH\)/);
  assert.match(parser, /offerIds\.has\(offerId\)/);
  assert.match(parser, /activeHospitalitySegments !== 1 \|\| matches !== 1/);
  assert.match(parser, /activeHospitalityOfferId = offerId/);
  assert.match(parser, /return Object\.freeze\(\{ offerIds, passiveOfferIds, activeHospitalityOfferId \}\)/);
  assert.match(parser, /if \(passiveOfferInd === true\) \{[\s\S]*?passiveOfferIds\.add\(offerId\);[\s\S]*?continue;/);
  assert.match(parser, /typeof passiveOfferInd !== 'boolean'/);
  const reservationTypeCheck = parser.indexOf("if (reservationType !== 'ReservationDetail')");
  const expectedMatch = parser.indexOf('const offerScope = assertExpectedReservationMatch(reservation, input.expectedReservation)');
  assert.ok(reservationTypeCheck >= 0 && expectedMatch > reservationTypeCheck, 'reservation type must be validated before segment authority');
  const offerTypeCheck = parser.indexOf("if (offerType !== 'Offer')");
  const passiveSkip = parser.indexOf('if (passiveOfferInd === true) {');
  assert.ok(offerTypeCheck >= 0 && passiveSkip > offerTypeCheck, 'offer type must be validated before passive scope');
  assert.match(parser, /supplier receipt evidence without active hotel offer scope/);
  assert.match(parser, /supplier receipt evidence outside the active hotel offer/);
  assert.match(parser, /normalizedOfferRefs\.length !== 1[\s\S]*?normalizedOfferRefs\[0\] !== offerScope\.activeHospitalityOfferId/);
  assert.match(parser, /new Set\(normalizedOfferRefs\)\.size !== normalizedOfferRefs\.length/);
  assert.match(parser, /travelportReceipts\[0\]!\.status !== 'Confirmed'/);
  assert.match(parser, /supplierReceipts\.some\(\(receipt\) => receipt\.status !== 'Confirmed'\)/);
  assert.doesNotMatch(parser, /CardNumber|SeriesCode|PaymentCard|FormOfPayment/);
});

test('response evidence durability cannot make Travelport reservation creation reachable', async () => {
  const parser = await source('src/server/suppliers/travelport-stays-reservation-response.ts');
  const recovery = await source('src/server/suppliers/travelport-stays-reservation-recovery-provider.ts');
  const docs = await source('docs/travelport-reservation-response-evidence.md');
  const schema = await source('prisma/hospitality-supplier-reservations.prisma');

  for (const value of [parser, recovery]) {
    assert.doesNotMatch(value, /book\/reservations\/build/);
    assert.doesNotMatch(value, /acceptPriceChangeInd|acceptGuaranteeChangeInd/);
  }
  assert.match(schema, /supplierConfirmationReference\s+String\?/);
  assert.match(docs, /supplier reservation ledger persists optional provider and supplier confirmation references/i);
  assert.match(docs, /top-level `ErrorResponse`.*contradictory provider evidence/is);
  assert.match(docs, /Travelport `reservation` remains disabled/i);
  assert.match(docs, /PCI-safe payment source/i);
});
