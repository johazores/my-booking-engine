import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (relativePath) => readFileSync(join(root, relativePath), 'utf8');

test('production preparation derives the durable reservation payload fingerprint from canonical traveler evidence', () => {
  const service = source('src/server/suppliers/hospitality-supplier-reservation-authority-service.ts');
  const start = service.indexOf('export async function prepareHospitalitySupplierReservationWithTravelerAuthority');
  const end = service.indexOf('export async function reviewAndClaimHospitalitySupplierReservationSubmission', start);
  const preparation = service.slice(start, end);

  assert.match(preparation, /traveler: HospitalitySupplierReservationTravelerPayloadInput/);
  assert.match(preparation, /normalizeHospitalitySupplierReservationTravelerPayload\(input\.traveler\)/);
  assert.match(preparation, /hospitalitySupplierReservationTravelerPayloadFingerprint\(traveler\)/);
  assert.match(preparation, /reservationPayloadFingerprint,/);
  assert.match(preparation, /prepareHospitalitySupplierReservation\(\{/);
  assert.doesNotMatch(preparation, /input\.selection\.reservationPayloadFingerprint/);
});

test('no production supplier module bypasses traveler-authorized preparation', () => {
  const suppliers = join(root, 'src/server/suppliers');
  const allowed = new Set([
    'hospitality-supplier-reservation-authority-service.ts',
    'hospitality-supplier-reservation-service.ts',
  ]);
  const bypasses = [];

  for (const name of readdirSync(suppliers)) {
    if (!name.endsWith('.ts') || name.endsWith('.test.ts') || name.endsWith('.integration.ts') || allowed.has(name)) continue;
    const contents = readFileSync(join(suppliers, name), 'utf8');
    if (/prepareHospitalitySupplierReservation\(/.test(contents)) bypasses.push(name);
  }

  assert.deepEqual(bypasses, []);
});

test('submission rebinds one-room primary traveler identity and contact before provider I/O or claim', () => {
  const service = source('src/server/suppliers/hospitality-supplier-reservation-authority-service.ts');
  const start = service.indexOf('export async function reviewAndClaimHospitalitySupplierReservationSubmission');
  const submission = service.slice(start);

  const authIndex = submission.indexOf('await requireSupplierReservationReviewAuthority(input)');
  const readIndex = submission.indexOf('db.hospitalitySupplierReservationOperation.findFirst', authIndex);
  const stateIndex = submission.indexOf('assertHospitalitySupplierReservationCanSubmit(reservation)', readIndex);
  const roomIndex = submission.indexOf('reservation.rooms !== 1', stateIndex);
  const travelerIndex = submission.indexOf('assertHospitalitySupplierReservationTravelerPayloadAuthority', roomIndex);
  const integrationIndex = submission.indexOf('loadTravelportStaysIntegration', travelerIndex);
  const providerIndex = submission.indexOf('reservationAuthorityProvider.verifyReservationAuthority', integrationIndex);
  const claimIndex = submission.indexOf('claimHospitalitySupplierReservationSubmission({', providerIndex);

  assert.ok(
    authIndex >= 0
    && readIndex > authIndex
    && stateIndex > readIndex
    && roomIndex > stateIndex
    && travelerIndex > roomIndex
    && integrationIndex > travelerIndex
    && providerIndex > integrationIndex
    && claimIndex > providerIndex,
  );
  assert.match(submission, /where:\s*\{\s*id: input\.reservationId,\s*organizationId: input\.organizationId/);
  assert.match(submission, /expectedFingerprint: reservation\.reservationPayloadFingerprint/);
  assert.match(submission, /traveler: input\.traveler/);
  assert.match(submission, /return Object\.freeze\(\{ claim, submissionAuthority, travelerAuthority \}\)/);
});

test('traveler authority is bounded, canonical, deterministic and contains no payment or provider secrets', () => {
  const traveler = source('src/server/suppliers/hospitality-supplier-reservation-traveler-authority.ts');
  assert.match(traveler, /MAX_NAME_LENGTH = 80/);
  assert.match(traveler, /MAX_EMAIL_LENGTH = 320/);
  assert.match(traveler, /countryCallingCode/);
  assert.match(traveler, /areaCode/);
  assert.match(traveler, /subscriberNumber/);
  assert.match(traveler, /createHash\('sha256'\)/);
  assert.match(traveler, /sf-hospitality-supplier-primary-traveler-v1/);
  assert.doesNotMatch(traveler, /cardNumber|cvv|seriesCode|accessToken|clientSecret|paymentCard|providerSubmissionReference/i);
});

test('traveler authority wrapper never writes raw traveler fields directly to persistence or audit JSON', () => {
  const service = source('src/server/suppliers/hospitality-supplier-reservation-authority-service.ts');
  const start = service.indexOf('export async function prepareHospitalitySupplierReservationWithTravelerAuthority');
  const end = service.indexOf('export async function reviewAndClaimHospitalitySupplierReservationSubmission', start);
  const preparation = service.slice(start, end);

  assert.doesNotMatch(preparation, /db\./);
  assert.doesNotMatch(preparation, /auditEvent|firstName:|lastName:|email:|telephone:/);
  assert.match(preparation, /reservationPayloadFingerprint,/);
});

test('documentation keeps traveler binding ephemeral and Travelport reservation disabled', () => {
  const doc = source('docs/supplier-reservation-traveler-authority.md');
  assert.match(doc, /single-room/i);
  assert.match(doc, /before provider I\/O/i);
  assert.match(doc, /reservationPayloadFingerprint/);
  assert.match(doc, /not persist/i);
  assert.match(doc, /first name/i);
  assert.match(doc, /email/i);
  assert.match(doc, /telephone/i);
  assert.match(doc, /PCI-safe/i);
  assert.match(doc, /Travelport `reservation` capability remains disabled/);
});
