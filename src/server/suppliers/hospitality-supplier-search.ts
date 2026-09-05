import {
  HospitalitySupplierProviderError,
  type HospitalitySupplierProperty,
  type HospitalitySupplierProvider,
  type HospitalitySupplierSearchInput,
  type HospitalitySupplierSearchResult,
} from './hospitality-supplier-provider.ts';

const MAX_COMPLETE_SEARCH_PAGES = 5;
const MAX_COMPLETE_SEARCH_PROPERTIES = 500;

export type HospitalitySupplierPropertySearch = Readonly<{
  providerCode: string;
  properties: readonly HospitalitySupplierProperty[];
  totalItems: number;
  pagesFetched: number;
}>;

function invalidProviderResponse(): never {
  throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
}

function assertFirstPage(result: HospitalitySupplierSearchResult) {
  if (result.page !== 1) invalidProviderResponse();
  if (result.totalPages < 0 || result.totalPages > MAX_COMPLETE_SEARCH_PAGES) invalidProviderResponse();
  if (result.totalItems < 0 || result.totalItems > MAX_COMPLETE_SEARCH_PROPERTIES) invalidProviderResponse();
  if (result.properties.length > result.pageSize || result.properties.length > result.totalItems) invalidProviderResponse();
  if (result.totalItems === 0 && (result.properties.length !== 0 || result.totalPages > 1)) invalidProviderResponse();
  if (result.totalItems > 0 && result.totalPages === 0) invalidProviderResponse();
  if (result.totalPages > 1 && !result.nextPageToken) invalidProviderResponse();
}

function assertContinuationPage(
  result: HospitalitySupplierSearchResult,
  expectedPage: number,
  firstPage: HospitalitySupplierSearchResult,
) {
  if (result.page !== expectedPage) invalidProviderResponse();
  if (result.totalPages !== firstPage.totalPages || result.totalItems !== firstPage.totalItems) invalidProviderResponse();
  if (result.properties.length > result.pageSize) invalidProviderResponse();
}

export async function collectHospitalitySupplierPropertySearch(
  provider: HospitalitySupplierProvider,
  input: HospitalitySupplierSearchInput,
): Promise<HospitalitySupplierPropertySearch> {
  const firstPage = await provider.searchProperties(input);
  assertFirstPage(firstPage);

  const properties: HospitalitySupplierProperty[] = [];
  const references = new Set<string>();
  const append = (page: HospitalitySupplierSearchResult) => {
    for (const property of page.properties) {
      if (references.has(property.supplierPropertyReference)) invalidProviderResponse();
      references.add(property.supplierPropertyReference);
      properties.push(property);
    }
  };
  append(firstPage);

  const totalPages = Math.max(1, firstPage.totalPages);
  if (totalPages > 1) {
    const pageToken = firstPage.nextPageToken;
    if (!pageToken) invalidProviderResponse();
    for (let pageNumber = 2; pageNumber <= totalPages; pageNumber += 1) {
      const page = await provider.searchPropertiesPage({ pageToken, pageNumber });
      assertContinuationPage(page, pageNumber, firstPage);
      append(page);
    }
  }

  if (properties.length !== firstPage.totalItems) invalidProviderResponse();

  return Object.freeze({
    providerCode: provider.code,
    properties: Object.freeze(properties),
    totalItems: firstPage.totalItems,
    pagesFetched: totalPages,
  });
}
