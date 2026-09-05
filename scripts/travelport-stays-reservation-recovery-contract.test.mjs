import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFileSync(new URL(path, root), 'utf8');

test('Travelport reservation recovery stays behind a provider-neutral contract', () => {
  const contract = source('src/server/suppliers/hospitality-supplier-reservation-recovery-provider.ts');
  const adapter = source('src/server/suppliers/travelport-stays-reservation-recovery-provider.ts');
  assert.match(contract, /HospitalitySupplierReservationRecoveryProvider/);
  assert.doesNotMatch(contract, /Travelport|ReservationResponse|sourceContext|book\/reservations/);
  assert.match(adapter, /book\/reservations\/\$\{encodeURIComponent\(reference\)\}/);
  assert.match(adapter, /sourceContext === 'Travelport'/);
});

test('Travelport recovery adapter is read-only and cannot create or silently accept a reservation change', () => {
  const adapter = source('src/server/suppliers/travelport-stays-reservation-recovery-provider.ts');
  assert.doesNotMatch(adapter, /book\/reservations\/build|method:\s*'POST'|acceptPriceChangeInd|acceptGuaranteeChangeInd|createReservation/);
  assert.match(adapter, /method:\s*'GET'/);
  assert.match(adapter, /response\.status === 404/);
});

test('Travelport reservation capability remains closed while known-locator recovery is available server-side', () => {
  const provider = source('src/server/suppliers/travelport-stays-provider.ts');
  const integration = source('src/server/integrations/travelport-stays-integration.ts');
  assert.match(provider, /capabilities: Object\.freeze\(\['availability', 'hotel-search', 'pricing'\] as const\)/);
  assert.doesNotMatch(provider, /\['availability', 'hotel-search', 'pricing', 'reservation'\]/);
  assert.match(integration, /reservationRecoveryProvider: TravelportStaysReservationRecoveryProvider/);
  assert.match(integration, /reservationRecoveryProvider: new TravelportStaysReservationRecoveryProvider/);
});

test('Travelport recovery source contains no reservation persistence, audit, or application logging path', () => {
  const adapter = source('src/server/suppliers/travelport-stays-reservation-recovery-provider.ts');
  assert.doesNotMatch(adapter, /db\.|prisma|auditEvent|logger|console\.|afterData|beforeData/);
});

test('supplier source-of-truth docs keep known-locator recovery separate from unverified create authority', () => {
  const integrationDoc = source('docs/travelport-stays-integration.md');
  const ledgerDoc = source('docs/supplier-reservation-operations.md');
  const roadmap = source('docs/product-roadmap.md');
  for (const document of [integrationDoc, ledgerDoc, roadmap]) {
    assert.match(document, /known-locator|known locator/i);
    assert.match(document, /lowestPublicAvailableRate\/rateKey\/value/);
    assert.match(document, /reservation.*(unadvertised|not advertised|remains closed|create.*closed)/is);
  }
  assert.match(integrationDoc, /no Travelport `POST book\/reservations\/build` call/);
  assert.match(ledgerDoc, /must not pass an arbitrary selected room-rate key as `CatalogOfferingIdentifier`/);
});
