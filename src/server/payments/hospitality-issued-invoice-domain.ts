import { createHash } from 'node:crypto';

const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const AUSTRALIAN_TAX_INVOICE_NUMBER_PATTERN = /^AU-TAX-[0-9]{8,}$/;

export class HospitalityIssuedInvoiceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HospitalityIssuedInvoiceValidationError';
  }
}

export const hospitalityIssuedInvoiceDocumentTypes = Object.freeze({
  taxInvoice: 'TAX_INVOICE' as const,
});

export type HospitalityIssuedTaxInvoiceSnapshot = Readonly<{
  schemaVersion: 1;
  kind: 'TAX_INVOICE';
  jurisdictionCode: 'AU';
  organizationId: string;
  bookingId: string;
  preparationId: string;
  pricingEvidenceId: string;
  issuerProfileId: string;
  documentNumber: string;
  sequenceValue: string;
  issuedAt: string;
  currency: string;
  accommodationSubtotalMinor: string;
  taxTotalMinor: string;
  feeTotalMinor: string;
  addonTotalMinor: string;
  totalMinor: string;
  preparationFingerprint: string;
  pricingFingerprint: string;
  issuerFingerprint: string;
  recipientFingerprint: string;
  issuer: Readonly<Record<string, unknown>>;
  recipient: Readonly<Record<string, unknown>>;
  pricing: Readonly<Record<string, unknown>>;
  australianTax: Readonly<{
    documentLabel: 'Tax invoice';
    supplierAbn: string;
    buyerIdentityRequired: boolean;
    buyerIdentity: string | null;
    buyerAbn: string | null;
  }>;
}>;

function requiredUuid(value: unknown, label: string) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) {
    throw new HospitalityIssuedInvoiceValidationError(`${label} must be a valid UUID.`);
  }
  return value.trim().toLowerCase();
}

function requiredFingerprint(value: unknown, label: string) {
  if (typeof value !== 'string') throw new HospitalityIssuedInvoiceValidationError(`${label} is invalid.`);
  const normalized = value.trim().toLowerCase();
  if (!FINGERPRINT_PATTERN.test(normalized)) {
    throw new HospitalityIssuedInvoiceValidationError(`${label} must be a SHA-256 fingerprint.`);
  }
  return normalized;
}

function money(value: unknown, label: string) {
  if (typeof value !== 'bigint' || value < 0n) {
    throw new HospitalityIssuedInvoiceValidationError(`${label} must be a non-negative bigint minor-unit amount.`);
  }
  return value;
}

function immutableObject(value: unknown, label: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HospitalityIssuedInvoiceValidationError(`${label} must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new HospitalityIssuedInvoiceValidationError('Invoice snapshot cannot contain non-finite numbers.');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const entry = record[key];
      if (entry === undefined) {
        throw new HospitalityIssuedInvoiceValidationError('Invoice snapshot cannot contain undefined values.');
      }
      normalized[key] = canonicalize(entry);
    }
    return normalized;
  }
  throw new HospitalityIssuedInvoiceValidationError('Invoice snapshot contains an unsupported value.');
}

export function canonicalHospitalityIssuedInvoiceJson(value: unknown) {
  return JSON.stringify(canonicalize(value));
}

export function formatAustralianTaxInvoiceDocumentNumber(sequenceValue: bigint) {
  if (sequenceValue <= 0n) {
    throw new HospitalityIssuedInvoiceValidationError('sequenceValue must be positive.');
  }
  return `AU-TAX-${sequenceValue.toString().padStart(8, '0')}`;
}

export function createHospitalityIssuedTaxInvoiceSnapshot(input: {
  organizationId: unknown;
  bookingId: unknown;
  preparationId: unknown;
  pricingEvidenceId: unknown;
  issuerProfileId: unknown;
  documentNumber: unknown;
  sequenceValue: unknown;
  issuedAt: unknown;
  currency: unknown;
  accommodationSubtotalMinor: unknown;
  taxTotalMinor: unknown;
  feeTotalMinor: unknown;
  addonTotalMinor: unknown;
  totalMinor: unknown;
  preparationFingerprint: unknown;
  pricingFingerprint: unknown;
  issuerFingerprint: unknown;
  recipientFingerprint: unknown;
  issuer: unknown;
  recipient: unknown;
  pricing: unknown;
  supplierAbn: unknown;
  buyerIdentityRequired: unknown;
  buyerIdentity: unknown;
  buyerAbn: unknown;
}): HospitalityIssuedTaxInvoiceSnapshot {
  if (typeof input.sequenceValue !== 'bigint' || input.sequenceValue <= 0n) {
    throw new HospitalityIssuedInvoiceValidationError('sequenceValue must be positive.');
  }
  const expectedDocumentNumber = formatAustralianTaxInvoiceDocumentNumber(input.sequenceValue);
  if (typeof input.documentNumber !== 'string' || input.documentNumber !== expectedDocumentNumber || !AUSTRALIAN_TAX_INVOICE_NUMBER_PATTERN.test(input.documentNumber)) {
    throw new HospitalityIssuedInvoiceValidationError('documentNumber does not match the allocated Australian tax-invoice sequence.');
  }
  if (!(input.issuedAt instanceof Date) || Number.isNaN(input.issuedAt.getTime())) {
    throw new HospitalityIssuedInvoiceValidationError('issuedAt must be a valid Date.');
  }
  if (typeof input.currency !== 'string' || !CURRENCY_PATTERN.test(input.currency.trim().toUpperCase())) {
    throw new HospitalityIssuedInvoiceValidationError('currency must be a three-letter uppercase code.');
  }
  const accommodationSubtotalMinor = money(input.accommodationSubtotalMinor, 'accommodationSubtotalMinor');
  const taxTotalMinor = money(input.taxTotalMinor, 'taxTotalMinor');
  const feeTotalMinor = money(input.feeTotalMinor, 'feeTotalMinor');
  const addonTotalMinor = money(input.addonTotalMinor, 'addonTotalMinor');
  const totalMinor = money(input.totalMinor, 'totalMinor');
  if (accommodationSubtotalMinor + taxTotalMinor + feeTotalMinor + addonTotalMinor !== totalMinor) {
    throw new HospitalityIssuedInvoiceValidationError('Issued invoice totals do not reconcile.');
  }
  if (typeof input.supplierAbn !== 'string' || !/^\d{11}$/.test(input.supplierAbn)) {
    throw new HospitalityIssuedInvoiceValidationError('supplierAbn must be the verified 11-digit Australian Business Number.');
  }
  if (typeof input.buyerIdentityRequired !== 'boolean') {
    throw new HospitalityIssuedInvoiceValidationError('buyerIdentityRequired must be boolean.');
  }
  const buyerIdentity = input.buyerIdentity === null ? null : typeof input.buyerIdentity === 'string' && input.buyerIdentity.trim() ? input.buyerIdentity.trim() : null;
  const buyerAbn = input.buyerAbn === null ? null : typeof input.buyerAbn === 'string' && /^\d{11}$/.test(input.buyerAbn) ? input.buyerAbn : null;
  if (input.buyerIdentityRequired && !buyerIdentity && !buyerAbn) {
    throw new HospitalityIssuedInvoiceValidationError('Verified buyer identity is required for this Australian tax invoice.');
  }

  return Object.freeze({
    schemaVersion: 1,
    kind: 'TAX_INVOICE',
    jurisdictionCode: 'AU',
    organizationId: requiredUuid(input.organizationId, 'organizationId'),
    bookingId: requiredUuid(input.bookingId, 'bookingId'),
    preparationId: requiredUuid(input.preparationId, 'preparationId'),
    pricingEvidenceId: requiredUuid(input.pricingEvidenceId, 'pricingEvidenceId'),
    issuerProfileId: requiredUuid(input.issuerProfileId, 'issuerProfileId'),
    documentNumber: input.documentNumber,
    sequenceValue: input.sequenceValue.toString(),
    issuedAt: input.issuedAt.toISOString(),
    currency: input.currency.trim().toUpperCase(),
    accommodationSubtotalMinor: accommodationSubtotalMinor.toString(),
    taxTotalMinor: taxTotalMinor.toString(),
    feeTotalMinor: feeTotalMinor.toString(),
    addonTotalMinor: addonTotalMinor.toString(),
    totalMinor: totalMinor.toString(),
    preparationFingerprint: requiredFingerprint(input.preparationFingerprint, 'preparationFingerprint'),
    pricingFingerprint: requiredFingerprint(input.pricingFingerprint, 'pricingFingerprint'),
    issuerFingerprint: requiredFingerprint(input.issuerFingerprint, 'issuerFingerprint'),
    recipientFingerprint: requiredFingerprint(input.recipientFingerprint, 'recipientFingerprint'),
    issuer: immutableObject(input.issuer, 'issuer'),
    recipient: immutableObject(input.recipient, 'recipient'),
    pricing: immutableObject(input.pricing, 'pricing'),
    australianTax: Object.freeze({
      documentLabel: 'Tax invoice',
      supplierAbn: input.supplierAbn,
      buyerIdentityRequired: input.buyerIdentityRequired,
      buyerIdentity,
      buyerAbn,
    }),
  });
}

function recordString(record: Record<string, unknown>, name: string) {
  const value = record[name];
  if (typeof value !== 'string') throw new HospitalityIssuedInvoiceValidationError(`${name} is invalid.`);
  return value;
}

function recordBigint(record: Record<string, unknown>, name: string) {
  const value = recordString(record, name);
  if (!/^\d+$/.test(value)) throw new HospitalityIssuedInvoiceValidationError(`${name} is invalid.`);
  return BigInt(value);
}

export function parseHospitalityIssuedTaxInvoiceSnapshot(value: unknown): HospitalityIssuedTaxInvoiceSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HospitalityIssuedInvoiceValidationError('Persisted issued invoice snapshot must be an object.');
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1 || record.kind !== 'TAX_INVOICE' || record.jurisdictionCode !== 'AU') {
    throw new HospitalityIssuedInvoiceValidationError('Unsupported issued invoice snapshot contract.');
  }
  const australianTax = immutableObject(record.australianTax, 'australianTax');
  if (australianTax.documentLabel !== 'Tax invoice') {
    throw new HospitalityIssuedInvoiceValidationError('Australian tax invoice document label is invalid.');
  }
  return createHospitalityIssuedTaxInvoiceSnapshot({
    organizationId: record.organizationId,
    bookingId: record.bookingId,
    preparationId: record.preparationId,
    pricingEvidenceId: record.pricingEvidenceId,
    issuerProfileId: record.issuerProfileId,
    documentNumber: record.documentNumber,
    sequenceValue: recordBigint(record, 'sequenceValue'),
    issuedAt: new Date(recordString(record, 'issuedAt')),
    currency: record.currency,
    accommodationSubtotalMinor: recordBigint(record, 'accommodationSubtotalMinor'),
    taxTotalMinor: recordBigint(record, 'taxTotalMinor'),
    feeTotalMinor: recordBigint(record, 'feeTotalMinor'),
    addonTotalMinor: recordBigint(record, 'addonTotalMinor'),
    totalMinor: recordBigint(record, 'totalMinor'),
    preparationFingerprint: record.preparationFingerprint,
    pricingFingerprint: record.pricingFingerprint,
    issuerFingerprint: record.issuerFingerprint,
    recipientFingerprint: record.recipientFingerprint,
    issuer: record.issuer,
    recipient: record.recipient,
    pricing: record.pricing,
    supplierAbn: australianTax.supplierAbn,
    buyerIdentityRequired: australianTax.buyerIdentityRequired,
    buyerIdentity: australianTax.buyerIdentity,
    buyerAbn: australianTax.buyerAbn,
  });
}

export function hospitalityIssuedInvoiceFingerprint(snapshot: HospitalityIssuedTaxInvoiceSnapshot) {
  return createHash('sha256').update(canonicalHospitalityIssuedInvoiceJson(snapshot)).digest('hex');
}
