import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (path) => readFileSync(join(root, path), 'utf8');

test('submission authority service authorizes and tenant-scopes before provider I/O', () => {
  const service = source('src/server/suppliers/hospitality-supplier-reservation-authority-service.ts');
  const authIndex = service.indexOf('await requireSupplierReservationReviewAuthority(input)');
  const readIndex = service.indexOf('db.hospitalitySupplierReservationOperation.findFirst', authIndex);
  const stateIndex = service.indexOf('assertHospitalitySupplierReservationCanSubmit(reservation)', readIndex);
  const integrationIndex = service.indexOf('integration.id !== reservation.integrationId', stateIndex);
  const providerIndex = service.indexOf('reservationAuthorityProvider.verifyReservationAuthority', integrationIndex);
  const bindingIndex = service.indexOf('const submissionAuthority = assertHospitalitySupplierReservationSubmissionAuthority', providerIndex);
  const claimIndex = service.indexOf('const claim = await claimHospitalitySupplierReservationSubmission({', bindingIndex);
  assert.ok(authIndex >= 0 && readIndex > authIndex && stateIndex > readIndex && integrationIndex > stateIndex && providerIndex > integrationIndex && bindingIndex > providerIndex && claimIndex > bindingIndex);
  assert.match(service, /where:\s*\{\s*id: input\.reservationId,\s*organizationId: input\.organizationId/);
  assert.match(service, /integration\.id !== reservation\.integrationId/);
  assert.match(service, /integration\.credentialVersion !== reservation\.integrationCredentialVersion/);
  assert.match(service, /!integration\.capabilities\.includes\('reservation'\)/);
  assert.match(service, /return Object\.freeze\(\{ claim, submissionAuthority \}\)/);
});

test('fresh authority carries exact ephemeral provider sell reference only through submission path', () => {
  const provider = source('src/server/suppliers/travelport-stays-reservation-authority-provider.ts');
  const binding = source('src/server/suppliers/hospitality-supplier-reservation-submission-authority.ts');
  const service = source('src/server/suppliers/hospitality-supplier-reservation-authority-service.ts');
  const publicReview = service.slice(
    service.indexOf('export async function reviewHospitalitySupplierReservationAuthority'),
    service.indexOf('export async function reviewAndClaimHospitalitySupplierReservationSubmission'),
  );
  assert.match(provider, /providerSubmissionReference: identifierValue/);
  assert.match(provider, /providerSubmissionReference: matches\[0\]!\.providerSubmissionReference/);
  assert.match(binding, /providerSubmissionReference: string \| null/);
  assert.match(binding, /providerSubmissionReference\(review\.providerSubmissionReference\)/);
  assert.match(binding, /providerSubmissionReference: submissionReference/);
  assert.doesNotMatch(publicReview, /providerSubmissionReference/);
  assert.match(publicReview, /authorityFingerprint: review\.authorityFingerprint/);
  assert.match(service, /const submissionAuthority = assertHospitalitySupplierReservationSubmissionAuthority\(reservation, review\)/);
});

test('fresh authority is rebuilt from durable evidence and rebound to request fingerprint v2', () => {
  const binding = source('src/server/suppliers/hospitality-supplier-reservation-submission-authority.ts');
  assert.match(binding, /operation\.requestFingerprintVersion !== 2/);
  assert.match(binding, /expectedOfferFingerprint: operation\.offerFingerprint/);
  assert.match(binding, /expectedTermsFingerprint: operation\.termsFingerprint/);
  assert.match(binding, /reservationPayloadFingerprint: operation\.reservationPayloadFingerprint/);
  assert.match(binding, /reservationAuthorityFingerprint: review\.authorityFingerprint/);
  assert.match(binding, /hospitalitySupplierReservationRequestFingerprint\(reboundSelection\) !== operation\.requestFingerprint/);
  assert.match(binding, /review\.bookingTerms\.completeForReservationReview !== true/);
});

test('no production supplier module bypasses the fresh-authority wrapper to claim create submission', () => {
  const suppliers = join(root, 'src/server/suppliers');
  const allowed = new Set([
    'hospitality-supplier-reservation-authority-service.ts',
    'hospitality-supplier-reservation-service.ts',
  ]);
  const bypasses = [];
  for (const name of readdirSync(suppliers)) {
    if (!name.endsWith('.ts') || name.endsWith('.test.ts') || name.endsWith('.integration.ts') || allowed.has(name)) continue;
    const contents = readFileSync(join(suppliers, name), 'utf8');
    if (/claimHospitalitySupplierReservationSubmission/.test(contents)) bypasses.push(name);
  }
  assert.deepEqual(bypasses, []);
});

test('Travelport reservation remains unavailable until the write adapter and PCI-safe boundary are ready', () => {
  const doc = source('docs/supplier-reservation-submission-authority.md');
  assert.match(doc, /does not enable Travelport `reservation` capability/);
  assert.match(doc, /PCI-safe form-of-payment\/guarantee strategy/);
  assert.match(doc, /ephemeral/i);
  assert.match(doc, /not persisted/i);
  assert.match(doc, /strips `providerSubmissionReference`/);
});
