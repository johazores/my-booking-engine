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
  assert.match(adapter, /normalizeExpectedReservation\(input\.expectedReservation\)/);
  assert.match(adapter, /expectedReservation,/);
  assert.match(responseParser, /sourceContext === 'Travelport'/);
  assert.match(responseParser, /exactly one hospitality segment matching the durable reservation request/i);
});

test('Travelport recovery maps durable request correlation into supportable provider headers', () => {
  const adapter = source('src/server/suppliers/travelport-stays-reservation-recovery-provider.ts');
  assert.doesNotMatch(adapter, /randomUUID/);
  assert.match(adapter, /E2ETrackingID: `sf-\$\{requestCorrelationId\}`/);
  assert.match(adapter, /TraceId: requestCorrelationId/);
  assert.match(adapter, /'Content-Type': 'application\/json'/);
  const correlationValidation = adapter.indexOf("'Request correlation ID'");
  const expectationValidation = adapter.indexOf('normalizeExpectedReservation(input.expectedReservation)');
  const accessTokenRequest = adapter.indexOf('await this.#accessToken()', expectationValidation);
  assert.ok(correlationValidation >= 0 && expectationValidation > correlationValidation, 'reservation expectation must be validated after correlation');
  assert.ok(accessTokenRequest > expectationValidation, 'reservation expectation must be validated before provider I/O');
});

test('Travelport recovery confirms only one retrieved hospitality segment matching durable property, stay, room, and guest identity', () => {
  const parser = source('src/server/suppliers/travelport-stays-reservation-response.ts');
  assert.match(parser, /product\['@type'\] !== 'ProductHospitality'/);
  assert.match(parser, /chainCode === expected\.chainCode/);
  assert.match(parser, /propertyCode === expected\.propertyCode/);
  assert.match(parser, /arrivalDateLocal === expected\.arrivalDateLocal/);
  assert.match(parser, /departureDateLocal === expected\.departureDateLocal/);
  assert.match(parser, /product\.Quantity === expected\.rooms/);
  assert.match(parser, /product\.guests === expected\.guests/);
  assert.match(parser, /if \(matches !== 1\)/);
  assert.doesNotMatch(parser, /PersonName|CardNumber|PaymentCard|FormOfPayment/);
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

test('supplier source-of-truth docs describe selected-offer authority without claiming create is live', () => {
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

  assert.match(integrationDoc, /No Travelport reservation create, modification, cancellation, refund, or customer\/staff reserve action is exposed yet\./);
  assert.match(ledgerDoc, /before any real supplier create call is exposed/);
  assert.match(gdsDoc, /No Travelport reservation create call or customer\/staff reserve action is exposed yet\./);
  assert.match(roadmap, /no external supplier booking action is exposed/);
  assert.match(integrationDoc, /PCI-safe form-of-payment\/guarantee strategy/i);
  assert.match(ledgerDoc, /SearchComplete-to-Availability bridge must be validated/i);
  assert.match(roadmap, /selected-offer.*Availability.*authority/is);
  assert.match(integrationDoc, /generic HTTP 404[\s\S]*not authoritative/i);
  assert.match(ledgerDoc, /generic HTTP 404[\s\S]*not authoritative/i);
  assert.match(gdsDoc, /generic HTTP 404[\s\S]*not authoritative/i);
  assert.match(recoveryIdentityDoc, /property identity/i);
  assert.match(recoveryIdentityDoc, /stay dates/i);
  assert.match(recoveryIdentityDoc, /room quantity/i);
  assert.match(recoveryIdentityDoc, /guest count/i);
  assert.match(recoveryIdentityDoc, /does not enable|does not advertise/i);
  assert.doesNotMatch(roadmap, /next dependency is therefore to establish the exact documented\/verified create authority/i);
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
