import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('review acceptance is tenant-authorized before provider credentials are loaded', () => {
  const service = source('src/server/suppliers/travelport-stays-reservation-review-acceptance-service.ts');
  const availability = service.indexOf("permission: 'availability:read'");
  const pricing = service.indexOf("permission: 'pricing:read'");
  const booking = service.indexOf("permission: 'booking:manage'");
  const reservationRead = service.indexOf('db.hospitalitySupplierReservationOperation.findFirst');
  const integrationLoad = service.indexOf('loadTravelportStaysIntegration(input.organizationId)');

  assert.ok(availability >= 0 && pricing > availability && booking > pricing);
  assert.ok(reservationRead > booking && integrationLoad > reservationRead);
  assert.match(service, /where: \{ id: input\.reservationId, organizationId: input\.organizationId \}/);
  assert.match(service, /reservation\.status !== 'REVIEW_REQUIRED'/);
  assert.match(service, /reservation\.reviewAcceptedAt/);
});

test('acceptance performs fresh offer, Rules, Availability, traveler, payment, and integration authority checks', () => {
  const service = source('src/server/suppliers/travelport-stays-reservation-review-acceptance-service.ts');
  const traveler = service.indexOf('assertHospitalitySupplierReservationTravelerPayloadAuthority');
  const offer = service.indexOf('current.provider.revalidatePropertyOffer', traveler);
  const rules = service.indexOf('current.bookingTermsProvider.retrieveBookingTerms', offer);
  const availability = service.indexOf('current.reservationAuthorityProvider.verifyReservationAuthority', rules);
  const payment = service.indexOf('deriveHospitalitySupplierReservationPaymentAuthority', availability);
  const transaction = service.indexOf('db.$transaction', payment);
  const integrationRecheck = service.indexOf('transaction.integration.findFirst', transaction);
  const persist = service.indexOf('reviewAcceptanceFingerprint: accepted.acceptanceFingerprint', integrationRecheck);

  assert.ok(
    traveler >= 0
      && offer > traveler
      && rules > offer
      && availability > rules
      && payment > availability
      && transaction > payment
      && integrationRecheck > transaction
      && persist > integrationRecheck,
  );
  assert.match(service, /integration\.credentialVersion !== reservation\.integrationCredentialVersion/);
  assert.match(service, /!integration\.capabilities\.includes\('reservation'\)/);
  assert.match(service, /finalAuthority\.offer\.supplierPropertyReference !== reservation\.supplierPropertyReference/);
  assert.match(service, /finalAuthority\.offer\.supplierOfferReference !== reservation\.supplierOfferReference/);
  assert.match(service, /isolationLevel: 'Serializable'/);
  assert.match(service, /pg_advisory_xact_lock/);
});

test('durable acceptance and audit persist the same validated commercial decision', () => {
  const service = source('src/server/suppliers/travelport-stays-reservation-review-acceptance-service.ts');
  const operationUpdate = service.indexOf('hospitalitySupplierReservationOperation.update');
  const auditCreate = service.indexOf('auditEvent.create', operationUpdate);
  const auditTotal = service.indexOf('acceptedTotalMinor: accepted.acceptedTotalMinor.toString()', auditCreate);
  const auditFingerprint = service.indexOf('acceptanceFingerprint: accepted.acceptanceFingerprint', auditTotal);

  assert.ok(operationUpdate >= 0 && auditCreate > operationUpdate && auditTotal > auditCreate && auditFingerprint > auditTotal);
  assert.doesNotMatch(service, /\bacccepted\b/);
});

test('durable acceptance is bounded and cannot become ordinary retry authority', () => {
  const schema = source('prisma/hospitality-supplier-reservations.prisma');
  const migration = source('prisma/migrations/20260907162000_supplier-reservation-review-acceptance/migration.sql');
  const domain = source('src/server/suppliers/hospitality-supplier-reservation-review-acceptance.ts');
  const acceptanceService = source('src/server/suppliers/travelport-stays-reservation-review-acceptance-service.ts');
  const submissionDomain = source('src/server/suppliers/hospitality-supplier-reservation-domain.ts');
  const createCoordinator = source('src/server/suppliers/travelport-stays-reservation-create-service.ts');

  for (const field of [
    'reviewAcceptedAt',
    'reviewAcceptedByUserId',
    'reviewAcceptedAttemptSequence',
    'reviewAcceptedPriceChange',
    'reviewAcceptedGuaranteeChange',
    'reviewAcceptedCurrency',
    'reviewAcceptedTotalMinor',
    'reviewAcceptedOfferFingerprint',
    'reviewAcceptedTermsFingerprint',
    'reviewAcceptedAuthorityFingerprint',
    'reviewAcceptanceFingerprint',
  ]) {
    assert.match(schema, new RegExp(field));
    assert.match(migration, new RegExp(field));
  }
  assert.match(migration, /"status" = 'REVIEW_REQUIRED'/);
  assert.match(migration, /"reviewAcceptedAttemptSequence" = "attemptCount"/);
  assert.match(domain, /sf:supplier-reservation-review-acceptance:v1/);
  assert.match(acceptanceService, /supplier\.reservation-review-accepted/);
  assert.match(submissionDomain, /input\.status === 'REVIEW_REQUIRED'/);
  assert.match(submissionDomain, /requires an explicit price or guarantee review decision/);
  assert.doesNotMatch(createCoordinator, /acceptPriceChangeInd|acceptGuaranteeChangeInd/);
});

test('documentation reflects implemented review consumption while keeping product activation closed', () => {
  const acceptanceDocs = source('docs/supplier-reservation-review-acceptance.md');
  const integrationDocs = source('docs/travelport-stays-integration.md');
  const responseDocs = source('docs/travelport-reservation-response-evidence.md');
  const roadmap = source('docs/product-roadmap.md');

  assert.match(acceptanceDocs, /second-request query parameters/);
  assert.match(acceptanceDocs, /one-time consumption and second Create/i);
  assert.match(acceptanceDocs, /HospitalitySupplierReservationReviewAcceptanceHistory/);
  assert.match(acceptanceDocs, /PCI-safe FormOfPayment/);
  assert.match(acceptanceDocs, /Normal retry must never/i);

  assert.match(integrationDocs, /createTravelportStaysReservationAfterAcceptedCommercialReviewWithSensitivePaymentCard/);
  assert.match(integrationDocs, /consumeHospitalitySupplierReservationReviewAcceptanceForProviderRequest/);
  assert.match(integrationDocs, /HospitalitySupplierReservationReviewAcceptanceHistory/);
  assert.match(integrationDocs, /initial Create.*never sends `acceptPriceChangeInd` or `acceptGuaranteeChangeInd`/is);
  assert.match(integrationDocs, /reservation.*unadvertised|does not advertise `reservation`/i);

  assert.match(responseDocs, /TravelportStaysReservationSyncExecutor/);
  assert.match(responseDocs, /acceptTravelportStaysReservationCommercialReview/);
  assert.doesNotMatch(responseDocs, /Sync itself remains unimplemented/);

  assert.match(roadmap, /one-time accepted-review second-write infrastructure is now implemented server-side/);
  assert.match(roadmap, /Initial Create continues to send neither flag/);
  assert.match(roadmap, /reservation` capability remains unadvertised/);
  assert.doesNotMatch(roadmap, /accepted decision is not yet consumed into Travelport's documented second Create request/);
});
