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
  const permissionIndex = service.indexOf('await requireSupplierReadAuthority');
  const loadIndex = service.indexOf('await loadTravelportStaysIntegration');
  assert.ok(permissionIndex >= 0 && loadIndex > permissionIndex);
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

test('supplier tests are included in the default local test command', () => {
  const packageJson = JSON.parse(source('package.json'));
  assert.match(packageJson.scripts.test, /src\/server\/suppliers\/\*\.test\.ts/);
});
