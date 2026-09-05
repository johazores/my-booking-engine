import { createCanonicalUserEmail } from '../users/user-domain.ts';

export type CustomerStatus = 'ACTIVE' | 'ARCHIVED';
export type CustomerSort = 'newest' | 'oldest' | 'name-asc' | 'name-desc';

export type CustomerInput = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  notes: string;
};

export class CustomerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CustomerValidationError';
  }
}

export const CUSTOMER_PAGE_SIZE_DEFAULT = 20;
export const CUSTOMER_PAGE_SIZE_MAX = 50;
export const DEIDENTIFIED_CUSTOMER_FIRST_NAME = 'De-identified';
export const DEIDENTIFIED_CUSTOMER_LAST_NAME = 'Customer';

function requiredName(value: string, label: string) {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > 80) {
    throw new CustomerValidationError(`${label} must be between 1 and 80 characters.`);
  }
  return normalized;
}

function optionalEmail(value: string) {
  const normalized = value.trim();
  if (!normalized) return null;
  try {
    return createCanonicalUserEmail(normalized);
  } catch {
    throw new CustomerValidationError('Customer email must be valid.');
  }
}

function optionalPhone(value: string) {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) return null;
  if (normalized.length > 40 || !/^[+0-9().\-\s]{5,40}$/.test(normalized)) {
    throw new CustomerValidationError('Customer phone contains unsupported characters.');
  }
  return normalized;
}

function optionalNotes(value: string) {
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > 5000) throw new CustomerValidationError('Customer notes must be 5000 characters or fewer.');
  return normalized;
}

export function normalizeCustomerInput(input: CustomerInput) {
  return {
    firstName: requiredName(input.firstName, 'First name'),
    lastName: requiredName(input.lastName, 'Last name'),
    email: optionalEmail(input.email),
    phone: optionalPhone(input.phone),
    notes: optionalNotes(input.notes),
  };
}

export function normalizeCustomerSearch(value: string | undefined) {
  const search = value?.trim().replace(/\s+/g, ' ') ?? '';
  return search.slice(0, 120);
}

export function parseCustomerStatus(value: string | undefined): CustomerStatus | 'ALL' {
  return value === 'ARCHIVED' ? 'ARCHIVED' : value === 'ALL' ? 'ALL' : 'ACTIVE';
}

export function parseCustomerSort(value: string | undefined): CustomerSort {
  return value === 'oldest' || value === 'name-asc' || value === 'name-desc' ? value : 'newest';
}

export function parseCustomerPage(value: string | undefined) {
  const page = Number.parseInt(value ?? '', 10);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

export function parseCustomerPageSize(value: string | undefined) {
  const size = Number.parseInt(value ?? '', 10);
  if (!Number.isSafeInteger(size) || size < 1) return CUSTOMER_PAGE_SIZE_DEFAULT;
  return Math.min(size, CUSTOMER_PAGE_SIZE_MAX);
}

export function assertCustomerArchiveConfirmation(value: string) {
  if (value.trim().toUpperCase() !== 'ARCHIVE') {
    throw new CustomerValidationError('Type ARCHIVE to confirm customer archival.');
  }
}

export function assertCustomerDeidentificationConfirmation(value: string) {
  if (value.trim().toUpperCase() !== 'DEIDENTIFY') {
    throw new CustomerValidationError('Type DEIDENTIFY to confirm customer profile de-identification.');
  }
}
