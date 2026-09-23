import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const legalSettlementAuthorities = [
  'src/server/payments/hospitality-commercial-amendment-adjustment-readiness-service.ts',
  'src/server/payments/hospitality-commercial-amendment-increasing-adjustment-readiness-service.ts',
  'src/server/payments/hospitality-commercial-amendment-adjustment-orchestration-service.ts',
  'src/server/payments/hospitality-commercial-amendment-adjustment-note-service.ts',
  'src/server/payments/hospitality-commercial-amendment-increasing-adjustment-note-service.ts',
  'src/server/payments/hospitality-repeated-commercial-amendment-adjustment-note-service.ts',
  'src/server/payments/hospitality-repeated-commercial-amendment-increasing-adjustment-note-service.ts',
  'src/server/payments/hospitality-repeated-commercial-amendment-increasing-adjustment-availability-service.ts',
];

for (const path of legalSettlementAuthorities) {
  test(`${path} requires complete bounded legal payment evidence`, () => {
    const source = readFileSync(new URL(path, root), 'utf8');

    assert.match(source, /readHospitalityLegalPaymentEvidenceHistory/);
    assert.match(source, /paymentHistory\.complete/);
    assert.match(source, /paymentHistory\.transactions/);
    assert.doesNotMatch(source, /paymentTransaction\.findMany\s*\(/);
  });
}
