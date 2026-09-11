import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFileSync(new URL(path, root), 'utf8');

test('Travelport pagination follows the bounded provider contract and keeps opaque page authority server-side', () => {
  const provider = source('src/server/suppliers/travelport-stays-provider.ts');
  const providerCore = source('src/server/suppliers/travelport-stays-provider-core.ts');
  const contract = source('src/server/suppliers/hospitality-supplier-provider.ts');
  assert.match(contract, /HospitalitySupplierSearchPageInput/);
  assert.match(contract, /searchPropertiesPage\(input: HospitalitySupplierSearchPageInput\)/);
  assert.match(providerCore, /pageNumber < 2 \|\| input\.pageNumber > MAX_PAGE_NUMBER/);
  assert.match(providerCore, /search\/searchcomplete\/\$\{encodeURIComponent\(page\.pageToken\)\}\?pageNumber=\$\{page\.pageNumber\}/);
  assert.match(providerCore, /init: \{ method: 'GET' \}/);
  assert.match(providerCore, /if \(result\.page !== page\.pageNumber\) throw new HospitalitySupplierProviderError\('INVALID_RESPONSE'\)/);
  assert.match(provider, /exactMachineToken\(input\.pageToken, MAX_REFERENCE_LENGTH, 'request'\)/);
  assert.match(provider, /exactMachineToken\(pagination\.paginationToken, MAX_REFERENCE_LENGTH, 'response'\)/);
  assert.match(provider, /MAX_SEARCH_PAGES = 5/);
  assert.match(provider, /MAX_SEARCH_ITEMS = MAX_SEARCH_PAGE_SIZE \* MAX_SEARCH_PAGES/);
  assert.match(provider, /currentPage < 1/);
  assert.match(provider, /itemCount > 0 && \(currentPageSize < 1 \|\| pageCount < 1\)/);
  assert.match(provider, /pageCount === 0 && currentPage !== 1/);
  assert.match(provider, /pageCount > 0 && currentPage > pageCount/);
  assert.match(provider, /itemCount > pageCount \* MAX_SEARCH_PAGE_SIZE/);
  assert.match(provider, /const initialPath = '\/12\/hotel\/search\/searchcomplete'/);
  assert.match(provider, /parsed\.pathname === initialPath/);
  assert.match(provider, /queryEntries\.length !== 1/);
  assert.match(provider, /!\/\^\[2-5\]\$\/\.test\(queryEntries\[0\]\?\.\[1\] \?\? ''\)/);
  assert.match(provider, /return init\?\.method \?\? \(input instanceof Request \? input\.method : 'GET'\)/);
  assert.match(provider, /method !== 'POST' \|\| parsed\.search/);
  assert.match(provider, /method !== 'GET' \|\| !parsed\.pathname\.startsWith/);
  assert.match(provider, /currentPage !== requestAuthority\.expectedPage/);
  assert.match(provider, /requestAuthority\.initial/);
  assert.match(provider, /\(pageCount > 1\) !== \(pagination\.paginationToken !== undefined\)/);
  assert.match(provider, /validateSearchCompleteResponse\(payload, url, requestMethod\(input, init\)\)/);
});

test('Travelport transport authority rejects normalized credentials and OAuth tokens at the public boundary', () => {
  const provider = source('src/server/suppliers/travelport-stays-provider.ts');
  assert.match(provider, /exactConfigurationValue\(input\.username/);
  assert.match(provider, /exactConfigurationValue\(input\.password/);
  assert.match(provider, /exactConfigurationValue\(input\.clientId/);
  assert.match(provider, /exactConfigurationValue\(input\.clientSecret/);
  assert.match(provider, /exactConfigurationValue\(input\.accessGroup/);
  assert.match(provider, /TRAVELPORT_OAUTH_HOSTS/);
  assert.match(provider, /exactMachineToken\(object\.access_token, MAX_ACCESS_TOKEN_LENGTH, 'response'\)/);
  assert.match(provider, /requestTravelportStaysAccessTokenCore/);
  assert.match(provider, /probeTravelportStaysIntegrationHealthCore/);
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
  const providerCore = source('src/server/suppliers/travelport-stays-provider-core.ts');
  assert.match(contract, /HospitalitySupplierPricingProvider/);
  assert.match(contract, /amountMinor: bigint/);
  assert.match(contract, /validUntil: null/);
  assert.match(contract, /expectedOfferFingerprint: string/);
  assert.match(contract, /'OFFER_CHANGED'/);
  assert.match(providerCore, /'TVP-Cache-Control': 'no-cache'/);
  assert.match(providerCore, /parseMoneyMajorToMinor/);
  assert.match(providerCore, /offerFingerprint: fingerprintOffer/);
  assert.match(providerCore, /rulesRequiredBeforeReservation: true/);
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
  const adapterCore = source('src/server/suppliers/travelport-stays-booking-terms-provider-core.ts');
  assert.match(contract, /HospitalitySupplierBookingTermsProvider/);
  assert.match(contract, /completeForReservationReview: boolean/);
  assert.match(contract, /termsFingerprint: string/);
  assert.match(contract, /revalidationRequired: true/);
  assert.match(adapter, /extends CoreTravelportStaysBookingTermsProvider/);
  assert.match(adapter, /createTravelportStaysReferenceAuthorityFetch/);
  assert.match(adapterCore, /11\/hotel\//);
  assert.match(adapterCore, /rules\/offershospitality\/buildfromrequest/);
  assert.match(adapterCore, /bookingCode: bridge\.bookingCode/);
  assert.match(adapterCore, /storedAmount: moneyMinorToMajorString/);
  assert.match(adapterCore, /RoomStayCandidates/);
  assert.match(adapterCore, /await this\.#pricingProvider\.revalidatePropertyOffer\(input\)/);
  assert.match(adapterCore, /'TVP-Cache-Control': 'no-cache'/);
  assert.doesNotMatch(adapterCore, /book\/reservations|acceptPriceChangeInd|acceptGuaranteeChangeInd/);
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
