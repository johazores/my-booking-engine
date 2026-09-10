import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('Travelport commercial response discriminators are bounded before reservation or offer authority', () => {
  const classifier = source('src/server/suppliers/travelport-stays-reservation-create-outcome.ts');

  assert.match(classifier, /const MAX_RESERVATION_TYPE_LENGTH = 64;/);
  assert.match(classifier, /const MAX_OFFER_TYPE_LENGTH = 64;/);
  assert.match(classifier, /boundedText\(reservation\['@type'\], MAX_RESERVATION_TYPE_LENGTH\)/);
  assert.match(classifier, /if \(reservationType !== 'ReservationDetail'\) return invalidOfferEvidence\(\)/);
  assert.match(classifier, /boundedText\(offer\['@type'\], MAX_OFFER_TYPE_LENGTH\)/);
  assert.match(classifier, /if \(offerType !== 'Offer'\) return invalidOfferEvidence\(\)/);

  const reservationTypeCheck = classifier.indexOf("if (reservationType !== 'ReservationDetail')");
  const offersRead = classifier.indexOf('const offers = reservation.Offer;');
  const offerTypeCheck = classifier.indexOf("if (offerType !== 'Offer')");
  const productsRead = classifier.indexOf('const products = offer.Product;');
  assert.ok(reservationTypeCheck >= 0 && reservationTypeCheck < offersRead);
  assert.ok(offerTypeCheck >= 0 && offerTypeCheck < productsRead);
});

test('Booking.com Sync keeps the shared commercial classifier as its response authority', () => {
  const syncDomain = source('src/server/suppliers/travelport-stays-reservation-sync-domain.ts');
  assert.match(syncDomain, /classifyTravelportStaysReservationCreateOutcome\(\{/);
  assert.match(syncDomain, /body: normalizeDocumentedTravelportSyncProviderLocator\(input\.body\)/);
});

test('Booking.com Sync missing-locatorType compatibility is limited to the documented confirmed hospitality PNR shape', () => {
  const syncDomain = source('src/server/suppliers/travelport-stays-reservation-sync-domain.ts');

  assert.match(syncDomain, /function isDocumentedTravelportSyncPnrWithoutLocatorType/);
  assert.match(syncDomain, /receipt\['@type'\] !== 'ReceiptConfirmation'/);
  assert.match(syncDomain, /confirmation\['@type'\] !== 'ConfirmationHold'/);
  assert.match(syncDomain, /receipt\.OfferRef !== undefined/);
  assert.doesNotMatch(syncDomain, /receipt\.OfferRef !== undefined && receipt\.OfferRef !== null/);
  assert.match(syncDomain, /locator\.sourceContext === 'Travelport'/);
  assert.match(syncDomain, /locator\.locatorType === undefined/);
  assert.match(syncDomain, /offerStatus\?\.\['@type'\] === 'OfferStatusHospitality'/);
  assert.match(syncDomain, /offerStatus\.Status === 'Confirmed'/);
  assert.match(syncDomain, /!isDocumentedTravelportSyncPnrWithoutLocatorType\(receipt, confirmation, locator\)/);
});

test('commercial discriminator documentation keeps the scope narrow and capability disabled', () => {
  const doc = source('docs/travelport-commercial-reservation-discriminators.md');
  assert.match(doc, /ReservationDetail/);
  assert.match(doc, /Offer\.@type = Offer/);
  assert.match(doc, /does \*\*not\*\* add a commercial offer-ID requirement/i);
  assert.match(doc, /Travelport `reservation` remains disabled/i);
  assert.match(doc, /PCI-safe FormOfPayment/i);
  assert.match(doc, /13034/);
});