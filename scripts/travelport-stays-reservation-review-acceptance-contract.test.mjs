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
  assert.match(service, /isolationLevel: 'Serializable'/);
  assert.match(service, /pg_advisory_xact_lock/);
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

test('documentation keeps the second provider write and sensitive payment boundary closed', () => {
  const docs = source('docs/supplier-reservation-review-acceptance.md');
  assert.match(docs, /second-request query parameters/);
  assert.match(docs, /does not enable a second supplier write/);
  assert.match(docs, /PCI-safe FormOfPayment/);
  assert.match(docs, /normal submission therefore stays blocked/);
});
