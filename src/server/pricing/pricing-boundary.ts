import { PricingValidationError } from './money.ts';

export const PRICING_PAGE_SIZE_DEFAULT = 20;
export const PRICING_PAGE_SIZE_MAX = 50;

export function normalizePricingPagination(pageInput: number, pageSizeInput: number) {
  const page = Number.isSafeInteger(pageInput) && pageInput > 0 ? pageInput : 1;
  const pageSize = Number.isSafeInteger(pageSizeInput) && pageSizeInput > 0
    ? Math.min(pageSizeInput, PRICING_PAGE_SIZE_MAX)
    : PRICING_PAGE_SIZE_DEFAULT;
  return { page, pageSize };
}

export function normalizePricingFingerprint(value: string) {
  const fingerprint = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
    throw new PricingValidationError('Pricing fingerprint must be a 64-character SHA-256 hexadecimal value.');
  }
  return fingerprint;
}
