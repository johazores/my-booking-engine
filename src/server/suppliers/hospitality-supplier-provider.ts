export const hospitalitySupplierFailureCodes = [
  'AUTHENTICATION_FAILED',
  'RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
  'TIMEOUT',
  'INVALID_REQUEST',
  'INVALID_RESPONSE',
] as const;

export type HospitalitySupplierFailureCode = (typeof hospitalitySupplierFailureCodes)[number];

export class HospitalitySupplierProviderError extends Error {
  readonly code: HospitalitySupplierFailureCode;
  readonly retryable: boolean;

  constructor(code: HospitalitySupplierFailureCode, message = 'The hospitality supplier request could not be completed.') {
    super(message);
    this.name = 'HospitalitySupplierProviderError';
    this.code = code;
    this.retryable = code === 'RATE_LIMITED' || code === 'PROVIDER_UNAVAILABLE' || code === 'TIMEOUT';
  }
}

export type HospitalitySupplierSearchInput = Readonly<{
  cityIataCode: string;
  checkInDateLocal: string;
  checkOutDateLocal: string;
  rooms: number;
  adults: number;
  childAges?: readonly number[];
  radiusKm?: number;
}>;

export type HospitalitySupplierSearchPageInput = Readonly<{
  pageToken: string;
  pageNumber: number;
}>;

export type HospitalitySupplierProperty = Readonly<{
  supplierPropertyReference: string;
  name: string;
  propertyType: string | null;
  available: boolean;
}>;

export type HospitalitySupplierSearchResult = Readonly<{
  properties: readonly HospitalitySupplierProperty[];
  page: number;
  pageSize: number;
  totalPages: number;
  totalItems: number;
  nextPageToken: string | null;
}>;

export interface HospitalitySupplierProvider {
  readonly code: string;
  searchProperties(input: HospitalitySupplierSearchInput): Promise<HospitalitySupplierSearchResult>;
  searchPropertiesPage(input: HospitalitySupplierSearchPageInput): Promise<HospitalitySupplierSearchResult>;
}
