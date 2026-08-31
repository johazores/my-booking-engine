import { normalizeHospitalityAddonSelections, type HospitalityAddonSelectionInput } from '../pricing/hospitality-addon-domain.ts';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,120}$/;
const PRICING_FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BOOKING_GUESTS = 100;

export const bookingStates = ['PENDING_CONFIRMATION', 'CONFIRMED', 'CANCELLED'] as const;
export type BookingState = (typeof bookingStates)[number];

export const paymentStates = ['UNPAID', 'AUTHORIZED', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'FAILED'] as const;
export type PaymentState = (typeof paymentStates)[number];

export type HospitalityBookingGuestInput = {
  firstName: string;
  lastName: string;
  email?: string | null;
};

export type HospitalityBookingConfirmationInput = {
  holdId: string;
  customerId: string;
  idempotencyKey: string;
  expectedPricingFingerprint: string;
  addonSelections?: HospitalityAddonSelectionInput[];
  guests: HospitalityBookingGuestInput[];
};

export type HospitalityPriceSnapshotInput = {
  currency: string;
  accommodationSubtotalMinor: string;
  taxTotalMinor: string;
  feeTotalMinor: string;
  addonTotalMinor: string;
  totalMinor: string;
  pricingFingerprint: string;
};

export type HospitalityPriceSnapshot = {
  currency: string;
  accommodationSubtotalMinor: string;
  taxTotalMinor: string;
  feeTotalMinor: string;
  addonTotalMinor: string;
  totalMinor: string;
  pricingFingerprint: string;
};

export class BookingDomainValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BookingDomainValidationError';
  }
}

function requireNonEmpty(value: unknown, label: string) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BookingDomainValidationError(`${label} is required.`);
  }
  return value.trim();
}

function normalizeBoundedText(value: unknown, label: string, maxLength: number) {
  const normalized = requireNonEmpty(value, label);
  if (normalized.length > maxLength) throw new BookingDomainValidationError(`${label} must be at most ${maxLength} characters.`);
  return normalized;
}

function normalizeUuid(value: unknown, label: string) {
  const normalized = requireNonEmpty(value, label);
  if (!UUID_PATTERN.test(normalized)) throw new BookingDomainValidationError(`${label} must be a UUID.`);
  return normalized.toLowerCase();
}

function normalizeMoneyMinor(value: unknown, label: string) {
  const normalized = requireNonEmpty(value, label);
  if (!/^\d+$/.test(normalized)) {
    throw new BookingDomainValidationError(`${label} must be a non-negative integer minor-unit amount.`);
  }
  return BigInt(normalized).toString();
}

function normalizeGuestEmail(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new BookingDomainValidationError('Guest email must be a string.');
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) return null;
  if (normalized.length > 320 || !EMAIL_PATTERN.test(normalized)) throw new BookingDomainValidationError('Guest email must be a valid email address.');
  return normalized;
}

export function normalizeHospitalityBookingGuests(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new BookingDomainValidationError('At least one booking guest is required.');
  }
  if (value.length > MAX_BOOKING_GUESTS) {
    throw new BookingDomainValidationError(`Booking guests cannot exceed ${MAX_BOOKING_GUESTS}.`);
  }
  return value.map((guest, index) => {
    if (!guest || typeof guest !== 'object' || Array.isArray(guest)) {
      throw new BookingDomainValidationError(`Guest ${index + 1} must be an object.`);
    }
    const input = guest as Record<string, unknown>;
    return {
      firstName: normalizeBoundedText(input.firstName, `Guest ${index + 1} first name`, 80),
      lastName: normalizeBoundedText(input.lastName, `Guest ${index + 1} last name`, 80),
      email: normalizeGuestEmail(input.email),
    };
  });
}

export function normalizeBookingIdempotencyKey(value: unknown) {
  const normalized = requireNonEmpty(value, 'Idempotency key');
  if (!IDEMPOTENCY_KEY_PATTERN.test(normalized)) {
    throw new BookingDomainValidationError('Idempotency key must be 8-120 characters using letters, numbers, dot, underscore, colon, or hyphen.');
  }
  return normalized;
}

export function normalizeBookingPricingFingerprint(value: unknown) {
  const normalized = requireNonEmpty(value, 'Pricing fingerprint').toLowerCase();
  if (!PRICING_FINGERPRINT_PATTERN.test(normalized)) {
    throw new BookingDomainValidationError('Pricing fingerprint must be a SHA-256 hexadecimal digest.');
  }
  return normalized;
}

export function normalizeHospitalityBookingConfirmationInput(input: HospitalityBookingConfirmationInput) {
  return {
    holdId: normalizeUuid(input.holdId, 'Hold ID'),
    customerId: normalizeUuid(input.customerId, 'Customer ID'),
    idempotencyKey: normalizeBookingIdempotencyKey(input.idempotencyKey),
    expectedPricingFingerprint: normalizeBookingPricingFingerprint(input.expectedPricingFingerprint),
    addonSelections: normalizeHospitalityAddonSelections(input.addonSelections ?? []),
    guests: normalizeHospitalityBookingGuests(input.guests),
  };
}

export function createHospitalityPriceSnapshot(input: HospitalityPriceSnapshotInput): HospitalityPriceSnapshot {
  const currency = requireNonEmpty(input.currency, 'Currency').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new BookingDomainValidationError('Currency must be a three-letter ISO-style code.');
  }

  const snapshot = {
    currency,
    accommodationSubtotalMinor: normalizeMoneyMinor(input.accommodationSubtotalMinor, 'Accommodation subtotal'),
    taxTotalMinor: normalizeMoneyMinor(input.taxTotalMinor, 'Tax total'),
    feeTotalMinor: normalizeMoneyMinor(input.feeTotalMinor, 'Fee total'),
    addonTotalMinor: normalizeMoneyMinor(input.addonTotalMinor, 'Add-on total'),
    totalMinor: normalizeMoneyMinor(input.totalMinor, 'Booking total'),
    pricingFingerprint: normalizeBookingPricingFingerprint(input.pricingFingerprint),
  };

  const expectedTotal =
    BigInt(snapshot.accommodationSubtotalMinor) +
    BigInt(snapshot.taxTotalMinor) +
    BigInt(snapshot.feeTotalMinor) +
    BigInt(snapshot.addonTotalMinor);
  if (expectedTotal !== BigInt(snapshot.totalMinor)) {
    throw new BookingDomainValidationError('Booking total must equal accommodation, tax, fee, and add-on totals.');
  }

  return Object.freeze(snapshot);
}

export function assertBookingPriceSnapshotMatchesConfirmation(
  confirmation: HospitalityBookingConfirmationInput,
  snapshot: HospitalityPriceSnapshot,
) {
  const normalized = normalizeHospitalityBookingConfirmationInput(confirmation);
  if (normalized.expectedPricingFingerprint !== snapshot.pricingFingerprint) {
    throw new BookingDomainValidationError('Booking price snapshot does not match the expected pricing fingerprint.');
  }
}

const bookingTransitions: Readonly<Record<BookingState, readonly BookingState[]>> = {
  PENDING_CONFIRMATION: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['CANCELLED'],
  CANCELLED: [],
};

export function canTransitionBookingState(from: BookingState, to: BookingState) {
  return bookingTransitions[from].includes(to);
}

export function assertBookingStateTransition(from: BookingState, to: BookingState) {
  if (!canTransitionBookingState(from, to)) {
    throw new BookingDomainValidationError(`Booking state cannot transition from ${from} to ${to}.`);
  }
}

export function bookingConfirmationPayloadMatches(
  existing: HospitalityBookingConfirmationInput,
  incoming: HospitalityBookingConfirmationInput,
) {
  const left = normalizeHospitalityBookingConfirmationInput(existing);
  const right = normalizeHospitalityBookingConfirmationInput(incoming);
  return (
    left.holdId === right.holdId &&
    left.customerId === right.customerId &&
    left.idempotencyKey === right.idempotencyKey &&
    left.expectedPricingFingerprint === right.expectedPricingFingerprint &&
    JSON.stringify(left.addonSelections) === JSON.stringify(right.addonSelections) &&
    JSON.stringify(left.guests) === JSON.stringify(right.guests)
  );
}
