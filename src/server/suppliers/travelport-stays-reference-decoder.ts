import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';

const PROPERTY_KEYS = new Set(['chainCode', 'propertyCode', 'authority']);
const OFFER_KEYS = new Set(['chainCode', 'propertyCode', 'propertyAuthority', 'rateValue', 'rateAuthority']);
const ASCII_CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;

function hasExactKeys(value: Readonly<Record<string, unknown>>, allowed: ReadonlySet<string>): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.size && keys.every((key) => allowed.has(key));
}

/** Decode only canonical, strictly UTF-8, exact-shape Travelport property/offer references. */
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
    const decodedText = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const decoded: unknown = JSON.parse(decodedText);
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error('Supplier reference must be an object.');
    // SF-issued references use JSON.stringify. Reject alternate spellings, including duplicate keys.
    if (JSON.stringify(decoded) !== decodedText) throw new Error('Non-canonical supplier reference JSON.');
    const reference = decoded as Readonly<Record<string, unknown>>;
    if (
      typeof reference.chainCode !== 'string'
      || !/^[A-Za-z0-9]{1,16}$/.test(reference.chainCode)
      || typeof reference.propertyCode !== 'string'
      || !/^[A-Za-z0-9]{1,32}$/.test(reference.propertyCode)
    ) throw new Error('Supplier property identity is invalid.');

    if (hasExactKeys(reference, PROPERTY_KEYS)) {
      if (reference.authority !== 'TVPT') throw new Error('Supplier property authority is invalid.');
    } else if (hasExactKeys(reference, OFFER_KEYS)) {
      const rateValue = reference.rateValue;
      if (
        reference.propertyAuthority !== 'TVPT'
        || (reference.rateAuthority !== 'TVPT' && reference.rateAuthority !== 'BKNG')
        || typeof rateValue !== 'string'
        || !rateValue
        || rateValue.length > maxLength
        || !rateValue.isWellFormed()
        || rateValue.trim() !== rateValue
        || ASCII_CONTROL_PATTERN.test(rateValue)
      ) throw new Error('Supplier offer identity is invalid.');
    } else {
      throw new Error('Supplier reference shape is invalid.');
    }
    return reference;
  } catch {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Supplier reference is invalid.');
  }
}
