import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (relativePath) => readFileSync(join(root, relativePath), 'utf8');

function assertMaterializesCall(sourceText, providerCall, materializer) {
  const callIndex = sourceText.indexOf(providerCall);
  assert.ok(callIndex >= 0, `${providerCall} must exist`);
  const statementStart = sourceText.lastIndexOf('const ', callIndex);
  const callBlock = sourceText.slice(statementStart, sourceText.indexOf(';', callIndex) + 1);
  assert.match(callBlock, new RegExp(`${materializer}\\(`));
}

test('initial Create snapshots fresh Availability authority before commercial write consumption', () => {
  const service = source('src/server/suppliers/hospitality-supplier-reservation-authority-service.ts');
  const start = service.indexOf('export async function reviewAndClaimHospitalitySupplierReservationSubmission');
  const submission = service.slice(start);
  assertMaterializesCall(
    submission,
    'reservationAuthorityProvider.verifyReservationAuthority(authorityInput)',
    'materializeHospitalitySupplierReservationAuthorityResult',
  );
  const snapshotIndex = submission.indexOf('materializeHospitalitySupplierReservationAuthorityResult');
  const consumeIndex = submission.indexOf('assertHospitalitySupplierReservationSubmissionAuthority(reservation, review)');
  assert.ok(consumeIndex > snapshotIndex);
});

test('commercial review acceptance snapshots every fresh provider result before comparing or persisting it', () => {
  const service = source('src/server/suppliers/travelport-stays-reservation-review-acceptance-service.ts');
  assertMaterializesCall(service, 'current.provider.revalidatePropertyOffer(priorAuthorityInput)', 'materializeHospitalitySupplierOfferRevalidationResult');
  assertMaterializesCall(service, 'current.bookingTermsProvider.retrieveBookingTerms(refreshedOfferInput)', 'materializeHospitalitySupplierBookingTermsResult');
  assertMaterializesCall(service, 'current.reservationAuthorityProvider.verifyReservationAuthority({', 'materializeHospitalitySupplierReservationAuthorityResult');
  assert.match(service, /offerReview\.status === 'OFFER_CHANGED'/);
  assert.match(service, /termsReview\.bookingTerms\.supplierPropertyReference !== reservation\.supplierPropertyReference/);
  assert.match(service, /termsReview\.bookingTerms\.price\.totalMinor !== offerReview\.offer\.price\.totalMinor/);
  assert.match(service, /finalAuthority\.bookingTerms\.revalidationRequired !== true/);
  assert.match(service, /finalAuthority\.bookingTerms\.price\.totalMinor !== termsReview\.offer\.price\.totalMinor/);
});

test('accepted-review consumption requires unchanged offer evidence and snapshots all provider results', () => {
  const service = source('src/server/suppliers/travelport-stays-reservation-review-consumption-authority-service.ts');
  assertMaterializesCall(service, 'current.provider.revalidatePropertyOffer(priorAuthorityInput)', 'materializeHospitalitySupplierOfferRevalidationResult');
  assertMaterializesCall(service, 'current.bookingTermsProvider.retrieveBookingTerms(refreshedOfferInput)', 'materializeHospitalitySupplierBookingTermsResult');
  assertMaterializesCall(service, 'current.reservationAuthorityProvider.verifyReservationAuthority({', 'materializeHospitalitySupplierReservationAuthorityResult');
  assert.match(service, /offerReview\.status !== 'UNCHANGED'/);
  assert.match(service, /termsReview\.bookingTerms\.supplierOfferReference !== reservation\.supplierOfferReference/);
  assert.match(service, /termsReview\.bookingTerms\.price\.totalMinor !== stored\.acceptance\.acceptedTotalMinor/);
  assert.match(service, /finalAuthority\.bookingTerms\.revalidationRequired !== true/);
  assert.match(service, /finalAuthority\.bookingTerms\.price\.totalMinor !== stored\.acceptance\.acceptedTotalMinor/);
});

test('result materializer is allowlisted, branch-bounded and sanitizes hostile provider objects', () => {
  const authority = source('src/server/suppliers/hospitality-supplier-reservation-provider-result-authority.ts');
  assert.match(authority, /'INVALID_RESPONSE'/);
  assert.match(authority, /Supplier reservation provider result could not be materialized safely/);
  assert.match(authority, /MAX_GUARANTEE_TYPES = 16/);
  assert.match(authority, /MAX_PAYMENT_CARD_CODES = 32/);
  assert.match(authority, /MAX_DEPOSITS = 16/);
  assert.match(authority, /Object\.freeze\(snapshot\)/);
  assert.doesNotMatch(authority, /rawProviderPayload|providerResponseBody|credentials|accessToken/);
});

test('documentation keeps provider result hardening separate from activation claims', () => {
  const docs = source('docs/supplier-reservation-provider-result-authority.md');
  assert.match(docs, /commercial write authority/i);
  assert.match(docs, /one-read/i);
  assert.match(docs, /allowlist/i);
  assert.match(docs, /PCI-safe/i);
  assert.match(docs, /Travelport `reservation` remains deliberately disabled/);
  assert.match(docs, /GitHub Actions are not used/);
});
