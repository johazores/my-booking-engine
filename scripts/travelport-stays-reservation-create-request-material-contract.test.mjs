import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (relativePath) => readFileSync(join(root, relativePath), 'utf8');

test('Travelport request material is derived only after fresh submission authority and before the durable create claim', () => {
  const service = source('src/server/suppliers/hospitality-supplier-reservation-authority-service.ts');
  const start = service.indexOf('export async function reviewAndClaimHospitalitySupplierReservationSubmission');
  const submission = service.slice(start);

  const providerReviewIndex = submission.indexOf('reservationAuthorityProvider.verifyReservationAuthority(authorityInput)');
  const authorityIndex = submission.indexOf('assertHospitalitySupplierReservationSubmissionAuthority(reservation, review)', providerReviewIndex);
  const materialIndex = submission.indexOf('buildTravelportStaysReservationCreateRequestMaterial({', authorityIndex);
  const claimIndex = submission.indexOf('claimHospitalitySupplierReservationSubmission({', materialIndex);

  assert.ok(
    providerReviewIndex >= 0
    && authorityIndex > providerReviewIndex
    && materialIndex > authorityIndex
    && claimIndex > materialIndex,
  );
  assert.match(submission, /providerSubmissionReference: submissionAuthority\.providerSubmissionReference/);
  assert.match(submission, /traveler: travelerAuthority/);
  assert.match(submission, /paymentAuthority: submissionAuthority\.paymentAuthority/);
  assert.match(submission, /return Object\.freeze\(\{ claim, submissionAuthority, travelerAuthority, createRequestMaterial \}\)/);
});

test('Travelport request material maps only the non-secret reference, shared traveler and payment instruction', () => {
  const material = source('src/server/suppliers/travelport-stays-reservation-create-request-material.ts');
  const traveler = source('src/server/suppliers/travelport-stays-reservation-traveler-request.ts');

  assert.match(material, /BuildFromCatalogOfferingHospitality/);
  assert.match(material, /CatalogOfferingIdentifier/);
  assert.match(material, /buildTravelportStaysReservationTravelerRequest/);
  assert.match(traveler, /PersonName/);
  assert.match(traveler, /countryAccessCode/);
  assert.match(traveler, /areaCityCode/);
  assert.match(traveler, /phoneNumber/);
  assert.match(material, /moneyMinorToMajorString/);
  assert.match(material, /guaranteeInd/);
  assert.match(material, /depositInd/);
  for (const productionSource of [material, traveler]) {
    assert.doesNotMatch(productionSource, /CardNumber|SeriesCode|PlainText|CardHolderName|FormOfPayment/);
  }
});

test('shared Travelport traveler mapping rejects truncation rather than changing durable traveler authority', () => {
  const traveler = source('src/server/suppliers/travelport-stays-reservation-traveler-request.ts');
  const createMaterial = source('src/server/suppliers/travelport-stays-reservation-create-request-material.ts');
  const syncDomain = source('src/server/suppliers/travelport-stays-reservation-sync-domain.ts');
  const travelerDoc = source('docs/supplier-reservation-traveler-authority.md');

  assert.match(traveler, /MAX_TRAVELPORT_PERSON_NAME_LENGTH = 22/);
  assert.match(traveler, /firstName\.length \+ traveler\.lastName\.length > MAX_TRAVELPORT_PERSON_NAME_LENGTH/);
  assert.match(createMaterial, /buildTravelportStaysReservationTravelerRequest/);
  assert.match(syncDomain, /buildTravelportStaysReservationTravelerRequest/);
  assert.match(travelerDoc, /22 characters/i);
  assert.match(travelerDoc, /fail[^\n]*closed/i);
  assert.match(travelerDoc, /not truncate/i);
});

test('documentation keeps the material ephemeral and reservation capability disabled pending PCI-safe form of payment', () => {
  const readiness = source('docs/supplier-reservation-create-readiness.md');
  const travelerDoc = source('docs/supplier-reservation-traveler-authority.md');

  for (const doc of [readiness, travelerDoc]) {
    assert.match(doc, /PCI-safe/i);
    assert.match(doc, /Travelport `reservation` capability remains disabled/);
  }
  assert.match(readiness, /request material/i);
  assert.match(readiness, /FormOfPayment/);
  assert.match(readiness, /not persisted|must not be persisted/i);
});
