import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';

/** Decode only canonical, strictly UTF-8, JSON-object supplier references. */
export function decodeCanonicalTravelportStaysReference(
  value: unknown,
  maxLength: number,
): Readonly<Record<string, unknown>> {
  if (
    typeof value !== 'string'
    || !value
    || !Number.isSafeInteger(maxLength)
    || maxLength < 1
    || value.length > maxLength
    || !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Supplier reference is invalid.');
  }

  try {
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.toString('base64url') !== value) throw new Error('Non-canonical supplier reference.');
    const decoded: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error('Supplier reference must be an object.');
    return decoded as Readonly<Record<string, unknown>>;
  } catch {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Supplier reference is invalid.');
  }
}
