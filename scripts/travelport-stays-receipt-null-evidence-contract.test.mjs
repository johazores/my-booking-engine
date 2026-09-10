import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../src/server/suppliers/travelport-stays-reservation-receipt-evidence.ts', import.meta.url),
  'utf8',
);

test('canonical Stays confirmation receipts reject explicit-null source and OfferStatus evidence', () => {
  assert.match(
    source,
    /requireHospitalityDiscriminators && rawSource === null/,
    'canonical Stays receipt source must distinguish explicit null from omission',
  );
  assert.match(
    source,
    /requireHospitalityDiscriminators && offerStatus === null/,
    'canonical Stays receipt OfferStatus must distinguish explicit null from omission',
  );
});

test('canonical Stays cancellation receipts reject explicit-null source and OfferStatus evidence', () => {
  assert.match(
    source,
    /hasCanonicalStaysPair && offerStatus === null/,
    'canonical Stays cancellation OfferStatus must reject explicit null',
  );
  assert.match(
    source,
    /hasCanonicalStaysPair && rawSource === null/,
    'canonical Stays cancellation source must reject explicit null',
  );
});

test('generic multi-content evidence remains outside the Stays-only null guards', () => {
  assert.match(
    source,
    /normalizedReceipt\(locator, confirmation, hasSupportedStaysPair\)/,
    'receipt normalization must continue to scope strict hospitality checks to supported Stays pairs',
  );
});
