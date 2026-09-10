import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFileSync(new URL(path, root), 'utf8');

test('Travelport reservation recovery stays behind a provider-neutral contract with durable reservation expectation', () => {
  const contract = source('src/server/suppliers/hospitality-supplier-reservation-recovery-provider.ts');
  const coordinator = source('src/server/suppliers/hospitality-supplier-reservation-reconciliation-service.ts');
  const adapter = source('src/server/suppliers/travelport-stays-reservation-recovery-provider.ts');
  const responseParser = source('src/server/suppliers/travelport-stays-reservation-response.ts');
  assert.match(contract, /HospitalitySupplierReservationRecoveryProvider/);
  assert.match(contract, /requestCorrelationId: string/);
  assert.match(contract, /expectedReservation: HospitalitySupplierReservationRecoveryExpectation/);
  assert.match(contract, /supplierPropertyReference: string/);
  assert.match(contract, /arrivalDateLocal: string/);
  assert.match(contract, /departureDateLocal: string/);
  assert.match(contract, /childAges: readonly number\[\]/);
  assert.doesNotMatch(contract, /Travelport|ReservationResponse|sourceContext|book\/reservations/);
  assert.match(coordinator, /supplierPropertyReference: claim\.reservation\.supplierPropertyReference/);
  assert.match(coordinator, /arrivalDateLocal: dateOnly\(claim\.reservation\.arrivalDate\)/);
  assert.match(coordinator, /departureDateLocal: dateOnly\(claim\.reservation\.departureDate\)/);
  assert.match(coordinator, /childAges: Object\.freeze\(\[\.\.\.claim\.reservation\.childAges\]\)/);
  assert.match(coordinator, /requestCorrelationId: claim\.attempt\.id,[\s\S]*?expectedReservation/);
  assert.match(adapter, /book\/reservations\/\$\{encodeURIComponent\(reference\)\}/);
  assert.match(adapter, /normalizeTravelportStaysReservationExpectation\(input\.expectedReservation\)/);
  assert.match(adapter, /expectedReservation,/);
  assert.match(responseParser, /sourceContext === 'Travelport' && locatorType === 'PNR Locator'/);
  assert.match(responseParser, /exactly one Travelport PNR locator/i);
  assert.match(responseParser, /activeHospitalitySegments !== 1 \|\| matches !== 1/);
  assert.match(responseParser, /exactly one active hospitality segment matching the durable reservation request/i);
});

test('Travelport recovery maps durable request correlation into supportable provider headers', () => {
  const adapter = source('src/server/suppliers/travelport-stays-reservation-recovery-provider.ts');
  assert.doesNotMatch(adapter, /randomUUID/);
  assert.match(adapter, /E2ETrackingID: `sf-\$\{requestCorrelationId\}`/);
  assert.match(adapter, /TraceId: requestCorrelationId/);
  assert.match(adapter, /'Content-Type': 'application\/json'/);
  const correlationValidation = adapter.indexOf("'Request correlation ID'");
  const expectationValidation = adapter.indexOf('normalizeTravelportStaysReservationExpectation(input.expectedReservation)');
  const accessTokenRequest = adapter.indexOf('await this.#accessToken()', expectationValidation);
  assert.ok(correlationValidation >= 0 && expectationValidation > correlationValidation, 'reservation expectation must be validated after correlation');
  assert.ok(accessTokenRequest > expectationValidation, 'reservation expectation must be validated before provider I/O');
});

test('Travelport recovery confirms one active hospitality segment and binds receipt authority to active offer scope', () => {
  const parser = source('src/server/suppliers/travelport-stays-reservation-response.ts');
  const createClassifier = source('src/server/suppliers/travelport-stays-reservation-create-outcome.ts');
  assert.match(parser, /const productType = boundedProviderValue\(product\['@type'\], MAX_PRODUCT_TYPE_LENGTH\)/);
  assert.match(parser, /if \(productType !== 'ProductHospitality'\) continue/);
  assert.match(parser, /const offerType = boundedProviderValue\(offer\['@type'\], MAX_OFFER_TYPE_LENGTH\)/);
  assert.match(parser, /if \(offerType !== 'Offer'\)/);
  assert.match(parser, /const offerId = boundedProviderValue\(offer\.id, MAX_OFFER_REFERENCE_LENGTH\)/);
  assert.match(parser, /offerIds\.has\(offerId\)/);
  assert.match(parser, /const passiveOfferInd = offer\.passiveOfferInd/);
  assert.match(parser, /typeof passiveOfferInd !== 'boolean'/);
  assert.match(parser, /if \(passiveOfferInd === true\) \{[\s\S]*?passiveOfferIds\.add\(offerId\);[\s\S]*?continue;/);
  assert.match(parser, /chainCode === expected\.chainCode/);
  assert.match(parser, /propertyCode === expected\.propertyCode/);
  assert.match(parser, /arrivalDateLocal === expected\.arrivalDateLocal/);
  assert.match(parser, /departureDateLocal === expected\.departureDateLocal/);
  assert.match(parser, /product\.Quantity === expected\.rooms/);
  assert.match(parser, /product\.guests === expected\.guests/);
  assert.match(parser, /if \(activeHospitalitySegments !== 1 \|\| matches !== 1\)/);
  assert.match(parser, /const passiveReceiptEvidence = inspectTravelportStaysReservationReceiptEvidence\(\[receipt\]\)/);
  assert.match(parser, /passiveReceiptEvidence\.travelportPnrReceipts\.length > 0/);
  assert.match(parser, /passiveReceiptEvidence\.supplierConfirmationReceipts\.length > 0/);
  assert.match(parser, /passiveReceiptEvidence\.supplierCancellationReceipts\.length > 0/);
  assert.match(parser, /if \(hasPassiveReservationAuthority\)[\s\S]*?return false;/);
  assert.match(parser, /malformed passive reservation receipt evidence/i);
  assert.doesNotMatch(parser, /function isSupplierConfirmationReceipt/);
  assert.doesNotMatch(parser, /PersonName|CardNumber|PaymentCard|FormOfPayment/);
  assert.match(createClassifier, /offerEvidence\.valid/);
  assert.match(createClassifier, /offerEvidence\.hospitalitySegments === 1/);
  assert.match(createClassifier, /offerEvidence\.matches === 1/);
  assert.doesNotMatch(createClassifier, /passiveOfferInd === true/);
});

test('Travelport recovery adapter is read-only and generic HTTP 404 cannot authorize another create', () => {
  const adapter = source('src/server/suppliers/travelport-stays-reservation-recovery-provider.ts');
  assert.doesNotMatch(adapter, /book\/reservations\/build|method:\s*'POST'|acceptPriceChangeInd|acceptGuaranteeChangeInd|createReservation/);
  assert.match(adapter, /method:\s*'GET'/);
  assert.doesNotMatch(adapter, /if\s*\(response\.status === 404\)[\s\S]*?status:\s*'NOT_FOUND'/);
  assert.match(adapter, /return 'INVALID_RESPONSE'/);
});

test('Travelport reservation capability remains closed while known-locator recovery is available server-side', () => {
  const provider = source('src/server/suppliers/travelport-stays-provider.ts');
  const integration = source('src/server/integrations/travelport-stays-integration.ts');
  assert.match(provider, /capabilities: Object\.freeze\(\['availability', 'hotel-search', 'pricing'\] as const\)/);
  assert.doesNotMatch(provider, /\['availability', 'hotel-search', 'pricing', 'reservation'\]/);
  assert.match(integration, /reservationRecoveryProvider: TravelportStaysReservationRecoveryProvider/);
  assert.match(integration, /reservationRecoveryProvider: new TravelportStaysReservationRecoveryProvider/);
});

test('Travelport recovery source contains no reservation persistence, audit, or application logging path', () => {
  const adapter = source('src/server/suppliers/travelport-stays-reservation-recovery-provider.ts');
  assert.doesNotMatch(adapter, /db\.|prisma|auditEvent|logger|console\.|afterData|beforeData/);
});

test('supplier source-of-truth docs describe the implemented server-only write boundary without claiming activation', () => {
  const integrationDoc = source('docs/travelport-stays-integration.md');
  const ledgerDoc = source('docs/supplier-reservation-operations.md');
  const gdsDoc = source('docs/gds-integration.md');
  const roadmap = source('docs/product-roadmap.md');
  const recoveryIdentityDoc = source('docs/supplier-reservation-recovery-identity.md');

  for (const document of [integrationDoc, ledgerDoc, gdsDoc, roadmap]) {
    assert.match(document, /known-locator|known locator/i);
  }
  for (const document of [integrationDoc, ledgerDoc, gdsDoc]) {
    assert.match(document, /Availability/i);
    assert.match(document, /authorityFingerprint|authority fingerprint/i);
  }

  assert.match(integrationDoc, /server-only write infrastructure[\s\S]*single-room Create Reservation[\s\S]*reviewed second-Create path/i);
  assert.match(integrationDoc, /Travelport `reservation` remains disabled/i);
  assert.match(ledgerDoc, /server-only initial Create[\s\S]*reviewed second Create[\s\S]*Booking\.com Sync/i);
  assert.match(gdsDoc, /server-only single-room Create Reservation and Booking\.com Sync write executors\/coordinators are also implemented behind the disabled `reservation` capability/i);
  assert.match(roadmap, /one-time accepted-review second-write infrastructure is now implemented server-side/i);
  assert.match(integrationDoc, /concrete reviewed PCI-safe source/i);
  assert.match(roadmap, /reviewed PCI-safe form-of-payment\/guarantee source/i);
  assert.match(integrationDoc, /generic HTTP 404[\s\S]*not authoritative/i);
  assert.match(ledgerDoc, /generic HTTP 404[\s\S]*not authoritative/i);
  assert.match(gdsDoc, /generic HTTP 404[\s\S]*not authoritative/i);
  assert.match(recoveryIdentityDoc, /property identity/i);
  assert.match(recoveryIdentityDoc, /stay dates/i);
  assert.match(recoveryIdentityDoc, /room quantity/i);
  assert.match(recoveryIdentityDoc, /guest count/i);
  assert.match(recoveryIdentityDoc, /exactly one non-passive `ProductHospitality` segment/i);
  assert.match(recoveryIdentityDoc, /passiveOfferInd=true/i);
  assert.match(recoveryIdentityDoc, /does not enable|does not advertise/i);

  assert.doesNotMatch(gdsDoc, /dedicated one-time claim\/consumption boundary[\s\S]*remain intentionally closed/i);
});

test('provider reconciliation never accepts provider truth for a different locator', () => {
  const coordinator = source('src/server/suppliers/hospitality-supplier-reservation-reconciliation-service.ts');
  const ledger = source('src/server/suppliers/hospitality-supplier-reservation-service.ts');
  assert.match(coordinator, /result\.providerReservationReference !== providerReservationReference/);
  assert.match(coordinator, /status: 'UNKNOWN', failureCode: 'INVALID_RESPONSE'/);
  const identityCheck = coordinator.indexOf('result.providerReservationReference !== providerReservationReference');
  const notFoundSettlement = coordinator.indexOf("status: 'NOT_FOUND'", identityCheck);
  assert.ok(identityCheck >= 0 && notFoundSettlement > identityCheck, 'locator identity must be verified before NOT_FOUND settlement');
  assert.match(coordinator, /status: 'NOT_FOUND'[\s\S]*?providerReservationReference: result\.providerReservationReference/);
  assert.match(ledger, /status: 'NOT_FOUND'[\s\S]*?providerReservationReference: unknown/);
  assert.match(ledger, /input\.outcome\.status === 'FOUND' \|\| input\.outcome\.status === 'NOT_FOUND'[\s\S]*?reservation\.providerReservationReference !== providerReservationReference/);
});
