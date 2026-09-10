import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const parser = readFileSync(
  new URL('../src/server/suppliers/travelport-stays-reservation-response.ts', import.meta.url),
  'utf8',
);

test('known-locator Travelport PNR authority remains reservation-level', () => {
  assert.match(
    parser,
    /if \(activeReceiptEvidence\.travelportPnrReceipts\.length > 0\) \{[\s\S]*?offer-scoped Travelport PNR receipt evidence/,
  );
  assert.match(
    parser,
    /receipt\.OfferRef === undefined \|\| receipt\.OfferRef === null[\s\S]*?unscopedReceiptEvidence[\s\S]*?return true;/,
  );

  const scopedPnrRejection = parser.indexOf('activeReceiptEvidence.travelportPnrReceipts.length > 0');
  const supplierScopeCheck = parser.indexOf('activeReceiptEvidence.supplierConfirmationReceipts.length > 0');
  const activeReceiptReturn = parser.indexOf('return true;', scopedPnrRejection);

  assert.ok(scopedPnrRejection >= 0, 'scoped Travelport PNR evidence must be rejected');
  assert.ok(
    supplierScopeCheck > scopedPnrRejection,
    'PNR reservation-level authority must be checked before supplier offer ownership',
  );
  assert.ok(
    activeReceiptReturn > supplierScopeCheck,
    'scoped Travelport PNR rejection must happen before active receipt acceptance',
  );
});
