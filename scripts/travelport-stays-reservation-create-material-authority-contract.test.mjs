import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (relativePath) => readFileSync(join(root, relativePath), 'utf8');

test('Travelport Create request material snapshots caller-owned authority before mapping', () => {
  const material = source('src/server/suppliers/travelport-stays-reservation-create-request-material.ts');
  const builderStart = material.indexOf('export function buildTravelportStaysReservationCreateRequestMaterial');
  const builder = material.slice(builderStart);

  assert.match(material, /MATERIALIZATION_FAILURE = 'Travelport reservation create request material authority could not be materialized safely\.'/);
  assert.match(material, /function snapshotTraveler\(/);
  assert.match(material, /function snapshotPaymentAuthority\(/);
  assert.match(material, /function snapshotAcceptedPaymentCardCodes\(/);
  assert.match(material, /function materializeInput\(/);
  assert.match(material, /Object\.freeze\(snapshot\)/);

  const materializeIndex = builder.indexOf('const authority = materializeInput(input)');
  const referenceIndex = builder.indexOf('providerSubmissionReference(authority.providerSubmissionReference)', materializeIndex);
  const travelerIndex = builder.indexOf('buildTravelportStaysReservationTravelerRequest(authority.traveler)', referenceIndex);
  const paymentIndex = builder.indexOf('paymentPayload(authority.paymentAuthority)', travelerIndex);
  assert.ok(materializeIndex >= 0 && referenceIndex > materializeIndex && travelerIndex > referenceIndex && paymentIndex > travelerIndex);
});

test('Travelport accepted-card machine syntax is aligned at Rules, Create material, and direct executor boundaries', () => {
  const rules = source('src/server/suppliers/travelport-stays-rules-member-authority.ts');
  const material = source('src/server/suppliers/travelport-stays-reservation-create-request-material.ts');
  const executor = source('src/server/suppliers/travelport-stays-reservation-create-executor.ts');

  for (const productionSource of [rules, material]) {
    assert.ok(productionSource.includes('const PAYMENT_CARD_CODE_PATTERN = /^[A-Z0-9]{2}$/;'));
    assert.match(productionSource, /PAYMENT_CARD_CODE_PATTERN\.test\(/);
  }
  assert.ok(executor.includes('/^[A-Z0-9]{2}$/'));
  assert.ok(!rules.includes('/^[A-Z0-9]{1,2}$/'));
  assert.ok(!material.includes('/^[A-Z0-9]{1,2}$/'));
  assert.ok(!executor.includes('/^[A-Z0-9]{1,2}$/'));
});

test('Create material remains non-secret and documentation preserves the activation boundary', () => {
  const material = source('src/server/suppliers/travelport-stays-reservation-create-request-material.ts');
  const doc = source('docs/travelport-stays-create-request-material-authority.md');

  assert.doesNotMatch(material, /CardNumber|SeriesCode|FormOfPayment|PlainText|securityCode|cardNumber/);
  assert.match(doc, /one-read/i);
  assert.match(doc, /PCI-safe/i);
  assert.match(doc, /remains deliberately disabled/i);
  assert.match(doc, /\[A-Z0-9\]/);
  assert.match(doc, /must not be persisted|not persisted/i);
});
