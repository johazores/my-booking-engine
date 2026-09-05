import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFileSync(new URL(path, root), 'utf8');

test('Travelport pagination follows the bounded provider contract and keeps opaque page authority server-side', () => {
  const provider = source('src/server/suppliers/travelport-stays-provider.ts');
  const contract = source('src/server/suppliers/hospitality-supplier-provider.ts');
  assert.match(contract, /HospitalitySupplierSearchPageInput/);
  assert.match(contract, /searchPropertiesPage\(input: HospitalitySupplierSearchPageInput\)/);
  assert.match(provider, /pageNumber < 2 \|\| input\.pageNumber > MAX_PAGE_NUMBER/);
  assert.match(provider, /search\/searchcomplete\/\$\{encodeURIComponent\(page\.pageToken\)\}\?pageNumber=\$\{page\.pageNumber\}/);
  assert.match(provider, /init: \{ method: 'GET' \}/);
  assert.match(provider, /if \(result\.page !== page\.pageNumber\) throw new HospitalitySupplierProviderError\('INVALID_RESPONSE'\)/);
});

test('supplier read operations authorize the active tenant before loading encrypted provider configuration', () => {
  const service = source('src/server/suppliers/hospitality-supplier-search-service.ts');
  const operationIndexes = [
    service.indexOf('searchHospitalitySupplierProperties'),
    service.indexOf('searchHospitalitySupplierPropertyOffers'),
    service.indexOf('revalidateHospitalitySupplierPropertyOffer'),
    service.indexOf('retrieveHospitalitySupplierBookingTerms'),
  ];
  for (const [index, operationIndex] of operationIndexes.entries()) {
    assert.ok(operationIndex >= 0);
    const nextOperationIndex = operationIndexes[index + 1] ?? service.length;
    const operation = service.slice(operationIndex, nextOperationIndex);
    const permissionIndex = operation.indexOf('await requireSupplierReadAuthority');
    const loadIndex = operation.indexOf('await loadTravelportStaysIntegration');
    assert.ok(permissionIndex >= 0 && loadIndex > permissionIndex);
  }
  assert.match(service, /permission: 'availability:read'/);
  assert.match(service, /permission: 'pricing:read'/);
  assert.doesNotMatch(service, /integration:read|integration:manage/);
});

test('pricing contract is exact-money, observed-only and requires fresh revalidation plus rules before reservation', () => {
  const contract = source('src/server/suppliers/hospitality-supplier-provider.ts');
  const provider = source('src/server/suppliers/travelport-stays-provider.ts');
  assert.match(contract, /HospitalitySupplierPricingProvider/);
  assert.match(contract, /amountMinor: bigint/);
  assert.match(contract, /validUntil: null/);
  assert.match(contract, /expectedOfferFingerprint: string/);
  assert.match(contract, /'OFFER_CHANGED'/);
  assert.match(provider, /'TVP-Cache-Control': 'no-cache'/);
  assert.match(provider, /parseMoneyMajorToMinor/);
  assert.match(provider, /offerFingerprint: fingerprintOffer/);
  assert.match(provider, /rulesRequiredBeforeReservation: true/);
  assert.doesNotMatch(provider, /createReservation|book\/reservations/);
});

test('Travelport capability migration updates only current records and preserves archived history', () => {
  const migration = source('prisma/migrations/20260906033000_travelport-stays-pricing-capabilities/migration.sql');
  assert.match(migration, /ARRAY\['availability', 'hotel-search', 'pricing'\]::TEXT\[\]/);
  assert.match(migration, /"providerCode" = 'travelport-stays'/);
  assert.match(migration, /"status" IN \('ACTIVE', 'DISABLED'\)/);
  assert.doesNotMatch(migration, /"status" = 'ARCHIVED'/);
});

test('complete supplier search consumes at most five pages and does not return the provider pagination token', () => {
  const search = source('src/server/suppliers/hospitality-supplier-search.ts');
  assert.match(search, /MAX_COMPLETE_SEARCH_PAGES = 5/);
  assert.match(search, /for \(let pageNumber = 2; pageNumber <= totalPages; pageNumber \+= 1\)/);
  assert.match(search, /properties\.length !== firstPage\.totalItems/);
  const returnBlock = search.slice(search.indexOf('return Object.freeze({', search.indexOf('collectHospitalitySupplierPropertySearch')));
  assert.match(returnBlock, /providerCode: provider\.code/);
  assert.match(returnBlock, /pagesFetched: totalPages/);
  assert.doesNotMatch(returnBlock, /pageToken|nextPageToken/);
});

test('Travelport Rules adapter retrieves full rate-rule evidence but never opens a reservation write boundary', () => {
  const contract = source('src/server/suppliers/hospitality-supplier-booking-terms.ts');
  const adapter = source('src/server/suppliers/travelport-stays-booking-terms-provider.ts');
  assert.match(contract, /HospitalitySupplierBookingTermsProvider/);
  assert.match(contract, /completeForReservationReview: boolean/);
  assert.match(contract, /termsFingerprint: string/);
  assert.match(contract, /revalidationRequired: true/);
  assert.match(adapter, /11\/hotel\//);
  assert.match(adapter, /rules\/offershospitality\/buildfromrequest/);
  assert.match(adapter, /bookingCode: bridge\.bookingCode/);
  assert.match(adapter, /storedAmount: moneyMinorToMajorString/);
  assert.match(adapter, /RoomStayCandidates/);
  assert.match(adapter, /await this\.#pricingProvider\.revalidatePropertyOffer\(input\)/);
  assert.match(adapter, /'TVP-Cache-Control': 'no-cache'/);
  assert.doesNotMatch(adapter, /book\/reservations|acceptPriceChangeInd|acceptGuaranteeChangeInd/);
});

test('Rules authority remains provider-specific and is wired through the existing tenant-authorized integration loader', () => {
  const integration = source('src/server/integrations/travelport-stays-integration.ts');
  const service = source('src/server/suppliers/hospitality-supplier-search-service.ts');
  assert.match(integration, /TravelportStaysBookingTermsProvider/);
  assert.match(integration, /pricingProvider: provider/);
  assert.match(service, /retrieveHospitalitySupplierBookingTerms/);
  assert.match(service, /bookingTermsProvider\.retrieveBookingTerms/);
  assert.doesNotMatch(service, /TravelportStaysBookingTermsProvider/);
});

test('supplier tests are included in the default local test command', () => {
  const packageJson = JSON.parse(source('package.json'));
  assert.match(packageJson.scripts.test, /src\/server\/suppliers\/\*\.test\.ts/);
});
