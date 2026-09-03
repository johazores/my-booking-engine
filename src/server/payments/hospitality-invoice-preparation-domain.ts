import { createHash } from 'node:crypto';

import {
  hospitalityInvoiceRecipientFingerprint,
  parseHospitalityInvoiceRecipientSnapshot,
  type HospitalityInvoiceRecipientSnapshot,
} from './hospitality-invoice-recipient-domain.ts';

const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class HospitalityInvoicePreparationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HospitalityInvoicePreparationValidationError';
  }
}

type HospitalityInvoicePreparationMoney = Readonly<{
  currency: string;
  accommodationSubtotalMinor: string;
  taxTotalMinor: string;
  feeTotalMinor: string;
  addonTotalMinor: string;
  totalMinor: string;
  pricingFingerprint: string;
  issuerFingerprint: string;
}>;

export type LegacyHospitalityInvoicePreparationSnapshot = HospitalityInvoicePreparationMoney & Readonly<{
  schemaVersion: 1;
  kind: 'INVOICE';
  pricingEvidenceId: string;
  issuerProfileId: string;
}>;

export type HospitalityInvoicePreparationSnapshot = HospitalityInvoicePreparationMoney & Readonly<{
  schemaVersion: 2;
  kind: 'INVOICE';
  pricingEvidenceId: string;
  issuerProfileId: string;
  recipientFingerprint: string;
  recipient: HospitalityInvoiceRecipientSnapshot;
}>;

export type HospitalityInvoicePreparationPersistedSnapshot =
  | LegacyHospitalityInvoicePreparationSnapshot
  | HospitalityInvoicePreparationSnapshot;

function requiredIdentifier(value: unknown, label: string) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) {
    throw new HospitalityInvoicePreparationValidationError(`${label} must be a valid UUID.`);
  }
  return value.trim().toLowerCase();
}

function fingerprint(value: unknown, label: string) {
  if (typeof value !== 'string') throw new HospitalityInvoicePreparationValidationError(`${label} is invalid.`);
  const normalized = value.trim().toLowerCase();
  if (!FINGERPRINT_PATTERN.test(normalized)) {
    throw new HospitalityInvoicePreparationValidationError(`${label} must be a SHA-256 fingerprint.`);
  }
  return normalized;
}

function currency(value: unknown) {
  if (typeof value !== 'string') throw new HospitalityInvoicePreparationValidationError('currency is invalid.');
  const normalized = value.trim().toUpperCase();
  if (!CURRENCY_PATTERN.test(normalized)) {
    throw new HospitalityInvoicePreparationValidationError('currency must be a three-letter uppercase code.');
  }
  return normalized;
}

function money(value: unknown, label: string) {
  if (typeof value !== 'bigint' || value < 0n) {
    throw new HospitalityInvoicePreparationValidationError(`${label} must be a non-negative bigint minor-unit amount.`);
  }
  return value;
}

function normalizedMoney(input: {
  currency: unknown;
  accommodationSubtotalMinor: unknown;
  taxTotalMinor: unknown;
  feeTotalMinor: unknown;
  addonTotalMinor: unknown;
  totalMinor: unknown;
  pricingFingerprint: unknown;
  issuerFingerprint: unknown;
}): HospitalityInvoicePreparationMoney {
  const accommodationSubtotalMinor = money(input.accommodationSubtotalMinor, 'accommodationSubtotalMinor');
  const taxTotalMinor = money(input.taxTotalMinor, 'taxTotalMinor');
  const feeTotalMinor = money(input.feeTotalMinor, 'feeTotalMinor');
  const addonTotalMinor = money(input.addonTotalMinor, 'addonTotalMinor');
  const totalMinor = money(input.totalMinor, 'totalMinor');
  if (accommodationSubtotalMinor + taxTotalMinor + feeTotalMinor + addonTotalMinor !== totalMinor) {
    throw new HospitalityInvoicePreparationValidationError('Invoice preparation totals do not reconcile.');
  }
  return Object.freeze({
    currency: currency(input.currency),
    accommodationSubtotalMinor: accommodationSubtotalMinor.toString(),
    taxTotalMinor: taxTotalMinor.toString(),
    feeTotalMinor: feeTotalMinor.toString(),
    addonTotalMinor: addonTotalMinor.toString(),
    totalMinor: totalMinor.toString(),
    pricingFingerprint: fingerprint(input.pricingFingerprint, 'pricingFingerprint'),
    issuerFingerprint: fingerprint(input.issuerFingerprint, 'issuerFingerprint'),
  });
}

type HospitalityInvoicePreparationBaseInput = {
  pricingEvidenceId: unknown;
  issuerProfileId: unknown;
  currency: unknown;
  accommodationSubtotalMinor: unknown;
  taxTotalMinor: unknown;
  feeTotalMinor: unknown;
  addonTotalMinor: unknown;
  totalMinor: unknown;
  pricingFingerprint: unknown;
  issuerFingerprint: unknown;
};

export function createHospitalityInvoicePreparationSnapshot(
  input: HospitalityInvoicePreparationBaseInput & { recipient: HospitalityInvoiceRecipientSnapshot },
): HospitalityInvoicePreparationSnapshot;
export function createHospitalityInvoicePreparationSnapshot(
  input: HospitalityInvoicePreparationBaseInput & { recipient?: undefined },
): LegacyHospitalityInvoicePreparationSnapshot;
export function createHospitalityInvoicePreparationSnapshot(
  input: HospitalityInvoicePreparationBaseInput & { recipient?: HospitalityInvoiceRecipientSnapshot },
): HospitalityInvoicePreparationPersistedSnapshot {
  const base = {
    kind: 'INVOICE' as const,
    pricingEvidenceId: requiredIdentifier(input.pricingEvidenceId, 'pricingEvidenceId'),
    issuerProfileId: requiredIdentifier(input.issuerProfileId, 'issuerProfileId'),
    ...normalizedMoney(input),
  };
  if (!input.recipient) return Object.freeze({ schemaVersion: 1 as const, ...base });

  const recipient = parseHospitalityInvoiceRecipientSnapshot(input.recipient);
  const recipientFingerprint = hospitalityInvoiceRecipientFingerprint(recipient);
  return Object.freeze({
    schemaVersion: 2,
    ...base,
    recipientFingerprint,
    recipient,
  });
}

function bigintField(record: Record<string, unknown>, name: string) {
  const candidate = record[name];
  if (typeof candidate !== 'string' || !/^\d+$/.test(candidate)) {
    throw new HospitalityInvoicePreparationValidationError(`${name} is invalid.`);
  }
  return BigInt(candidate);
}

function parseLegacySnapshot(record: Record<string, unknown>): LegacyHospitalityInvoicePreparationSnapshot {
  return Object.freeze({
    schemaVersion: 1,
    kind: 'INVOICE',
    pricingEvidenceId: requiredIdentifier(record.pricingEvidenceId, 'pricingEvidenceId'),
    issuerProfileId: requiredIdentifier(record.issuerProfileId, 'issuerProfileId'),
    ...normalizedMoney({
      currency: record.currency,
      accommodationSubtotalMinor: bigintField(record, 'accommodationSubtotalMinor'),
      taxTotalMinor: bigintField(record, 'taxTotalMinor'),
      feeTotalMinor: bigintField(record, 'feeTotalMinor'),
      addonTotalMinor: bigintField(record, 'addonTotalMinor'),
      totalMinor: bigintField(record, 'totalMinor'),
      pricingFingerprint: record.pricingFingerprint,
      issuerFingerprint: record.issuerFingerprint,
    }),
  });
}

export function parseHospitalityInvoicePreparationSnapshot(value: unknown): HospitalityInvoicePreparationPersistedSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HospitalityInvoicePreparationValidationError('Persisted invoice preparation must be an object.');
  }
  const record = value as Record<string, unknown>;
  if (record.kind !== 'INVOICE') {
    throw new HospitalityInvoicePreparationValidationError('Unsupported invoice preparation kind.');
  }
  if (record.schemaVersion === 1) return parseLegacySnapshot(record);
  if (record.schemaVersion !== 2) {
    throw new HospitalityInvoicePreparationValidationError('Unsupported invoice preparation schema version.');
  }

  const recipient = parseHospitalityInvoiceRecipientSnapshot(record.recipient);
  const snapshot = createHospitalityInvoicePreparationSnapshot({
    pricingEvidenceId: record.pricingEvidenceId,
    issuerProfileId: record.issuerProfileId,
    currency: record.currency,
    accommodationSubtotalMinor: bigintField(record, 'accommodationSubtotalMinor'),
    taxTotalMinor: bigintField(record, 'taxTotalMinor'),
    feeTotalMinor: bigintField(record, 'feeTotalMinor'),
    addonTotalMinor: bigintField(record, 'addonTotalMinor'),
    totalMinor: bigintField(record, 'totalMinor'),
    pricingFingerprint: record.pricingFingerprint,
    issuerFingerprint: record.issuerFingerprint,
    recipient,
  });
  if (snapshot.recipientFingerprint !== fingerprint(record.recipientFingerprint, 'recipientFingerprint')) {
    throw new HospitalityInvoicePreparationValidationError('Persisted invoice recipient fingerprint does not match its snapshot.');
  }
  return snapshot;
}

export function hospitalityInvoicePreparationFingerprint(snapshot: HospitalityInvoicePreparationPersistedSnapshot) {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

export function hospitalityInvoicePreparationKey(input: {
  organizationId: string;
  bookingId: string;
  snapshot: HospitalityInvoicePreparationPersistedSnapshot;
}) {
  const organizationId = requiredIdentifier(input.organizationId, 'organizationId');
  const bookingId = requiredIdentifier(input.bookingId, 'bookingId');
  const documentFingerprint = hospitalityInvoicePreparationFingerprint(input.snapshot);
  const digest = createHash('sha256')
    .update(JSON.stringify({ organizationId, bookingId, documentFingerprint }))
    .digest('hex');
  return `invoice-preparation:v${input.snapshot.schemaVersion}:${digest}`;
}
