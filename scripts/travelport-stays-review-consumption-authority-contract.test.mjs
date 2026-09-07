import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('stored review acceptance must be reconstructed from durable bounded evidence', () => {
  const domain = source('src/server/suppliers/hospitality-supplier-reservation-review-acceptance.ts');
  assert.match(domain, /assertHospitalitySupplierReservationStoredReviewAcceptance/);
  assert.match(domain, /input\.status !== 'REVIEW_REQUIRED'/);
  assert.match(domain, /input\.providerCode !== 'travelport-stays'/);
  assert.match(domain, /input\.reviewAcceptedAttemptSequence !== input\.attemptCount/);
  assert.match(domain, /createHospitalitySupplierReservationReviewAcceptance\(\{/);
  assert.match(domain, /input\.reviewAcceptanceFingerprint !== acceptance\.acceptanceFingerprint/);
});

test('consumption authority revalidates exact accepted offer, Rules and Availability before any write claim', () => {
  const service = source('src/server/suppliers/travelport-stays-reservation-review-consumption-authority-service.ts');
  const tenantRead = service.indexOf("where: { id: input.reservationId, organizationId: input.organizationId }");
  const stored = service.indexOf('assertHospitalitySupplierReservationStoredReviewAcceptance', tenantRead);
  const attempt = service.indexOf('assertHospitalitySupplierReservationReviewAttemptAuthority', stored);
  const integration = service.indexOf('loadTravelportStaysIntegration', attempt);
  const offer = service.indexOf('revalidatePropertyOffer', integration);
  const rules = service.indexOf('retrieveBookingTerms', offer);
  const availability = service.indexOf('verifyReservationAuthority', rules);
  const payment = service.indexOf('deriveHospitalitySupplierReservationPaymentAuthority', availability);

  assert.ok(tenantRead >= 0 && stored > tenantRead && attempt > stored && integration > attempt);
  assert.ok(offer > integration && rules > offer && availability > rules && payment > availability);
  assert.match(service, /expectedAcceptanceFingerprint !== stored\.acceptance\.acceptanceFingerprint/);
  assert.match(service, /offerFingerprint !== stored\.acceptance\.acceptedOfferFingerprint/);
  assert.match(service, /termsFingerprint !== stored\.acceptance\.acceptedTermsFingerprint/);
  assert.match(service, /authorityFingerprint !== stored\.acceptance\.acceptedAuthorityFingerprint/);
  assert.doesNotMatch(service, /book\/reservations\/build/);
  assert.doesNotMatch(service, /acceptPriceChangeInd|acceptGuaranteeChangeInd/);
  assert.doesNotMatch(service, /hospitalitySupplierReservationOperation\.(?:update|create)/);
  assert.doesNotMatch(service, /hospitalitySupplierReservationAttempt\.(?:update|create)/);
});
