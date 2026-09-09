import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const recoveryProvider = readFileSync(
  new URL('../src/server/suppliers/travelport-stays-reservation-recovery-provider.ts', import.meta.url),
  'utf8',
);
const responseParser = readFileSync(
  new URL('../src/server/suppliers/travelport-stays-reservation-response.ts', import.meta.url),
  'utf8',
);

test('Travelport known-locator recovery grants FOUND only from complete active reservation evidence', () => {
  assert.match(
    recoveryProvider,
    /requiresSupplierConfirmationForFound = true/,
  );
  assert.match(
    recoveryProvider,
    /parseTravelportStaysReservationResponse\(payload, \{[\s\S]*?expectedProviderReservationReference: reference,[\s\S]*?expectedReservation,[\s\S]*?requireConfirmedTravelportReceipt: true,/,
  );
  assert.match(
    responseParser,
    /sourceContext === 'Supplier' && locatorType === 'Cancellation Number'\) \{[\s\S]*?supplierCancellationEvidence = true;/,
  );
  assert.match(
    responseParser,
    /if \(input\.requireConfirmedTravelportReceipt\) \{[\s\S]*?status !== 'Confirmed'[\s\S]*?if \(supplierCancellationEvidence\)[\s\S]*?supplier cancellation evidence/,
  );
});
