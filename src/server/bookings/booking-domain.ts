import { normalizeHospitalityAddonSelections, type HospitalityAddonSelectionInput } from '../pricing/hospitality-addon-domain.ts';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,120}$/;
const PRICING_FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BOOKING_GUESTS = 100;
const MAX_STAY_NIGHTS = 365;
const MAX_ROOM_QUANTITY = 50;
const MAX_PRICING_LINES = 100;
const HOSPITALITY_CHARGE_KINDS = ['TAX', 'FEE'] as const;
const HOSPITALITY_CHARGE_CALCULATIONS = ['PERCENTAGE', 'FIXED_PER_BOOKING', 'FIXED_PER_ROOM_NIGHT'] as const;
const HOSPITALITY_ADDON_PRICING_MODELS = ['PER_BOOKING', 'PER_ROOM', 'PER_ROOM_NIGHT', 'PER_UNIT'] as const;

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

export type HospitalityPricingBreakdownSnapshotInput = HospitalityPriceSnapshotInput & {
  quantity: number;
  nightly: Array<{ date: string; amountMinor: string }>;
  charges: Array<{
    id: string;
    code: string;
    name: string;
    kind: string;
    calculation: string;
    amountMinor: string;
  }>;
  addons: Array<{
    id: string;
    code: string;
    name: string;
    pricingModel: string;
    selectedQuantity: number;
    amountMinor: string;
  }>;
};

export type HospitalityPricingBreakdownSnapshot = Readonly<{
  schemaVersion: 1;
  currency: string;
  quantity: number;
  accommodationSubtotalMinor: string;
  taxTotalMinor: string;
  feeTotalMinor: string;
  addonTotalMinor: string;
  totalMinor: string;
  pricingFingerprint: string;
  nightly: ReadonlyArray<Readonly<{ date: string; amountMinor: string }>>;
  charges: ReadonlyArray<Readonly<{
    ruleId: string;
    code: string;
    name: string;
    kind: 'TAX' | 'FEE';
    calculation: 'PERCENTAGE' | 'FIXED_PER_BOOKING' | 'FIXED_PER_ROOM_NIGHT';
    amountMinor: string;
  }>>;
  addons: ReadonlyArray<Readonly<{
    addonId: string;
    code: string;
    name: string;
    pricingModel: 'PER_BOOKING' | 'PER_ROOM' | 'PER_ROOM_NIGHT' | 'PER_UNIT';
    selectedQuantity: number;
    amountMinor: string;
  }>>;
}>;

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
  const normalized = requireNonEmpty(value, label).replace(/\s+/g, ' ');
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

function normalizePricingLineCode(value: unknown, label: string) {
  const normalized = requireNonEmpty(value, label).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(normalized)) {
    throw new BookingDomainValidationError(`${label} must use 1-32 letters, numbers, underscores, or hyphens.`);
  }
  return normalized;
}

function normalizePricingDate(value: unknown, label: string) {
  const normalized = requireNonEmpty(value, label);
  if (!DATE_PATTERN.test(normalized)) throw new BookingDomainValidationError(`${label} must use YYYY-MM-DD.`);
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new BookingDomainValidationError(`${label} must be a valid calendar date.`);
  }
  return normalized;
}

function normalizeEnumValue<const T extends readonly string[]>(value: unknown, label: string, allowed: T): T[number] {
  const normalized = requireNonEmpty(value, label).toUpperCase();
  if (!allowed.includes(normalized)) throw new BookingDomainValidationError(`${label} is not supported.`);
  return normalized as T[number];
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

export function createHospitalityPricingBreakdownSnapshot(
  input: HospitalityPricingBreakdownSnapshotInput,
): HospitalityPricingBreakdownSnapshot {
  const price = createHospitalityPriceSnapshot(input);
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > MAX_ROOM_QUANTITY) {
    throw new BookingDomainValidationError(`Pricing breakdown room quantity must be between 1 and ${MAX_ROOM_QUANTITY}.`);
  }
  if (!Array.isArray(input.nightly) || input.nightly.length < 1 || input.nightly.length > MAX_STAY_NIGHTS) {
    throw new BookingDomainValidationError(`Pricing breakdown must contain between 1 and ${MAX_STAY_NIGHTS} nightly prices.`);
  }
  if (!Array.isArray(input.charges) || input.charges.length > MAX_PRICING_LINES) {
    throw new BookingDomainValidationError(`Pricing breakdown cannot contain more than ${MAX_PRICING_LINES} charge lines.`);
  }
  if (!Array.isArray(input.addons) || input.addons.length > MAX_PRICING_LINES) {
    throw new BookingDomainValidationError(`Pricing breakdown cannot contain more than ${MAX_PRICING_LINES} add-on lines.`);
  }

  let previousDate = '';
  const nightly = input.nightly.map((night, index) => {
    const date = normalizePricingDate(night.date, `Night ${index + 1} date`);
    if (date <= previousDate) throw new BookingDomainValidationError('Pricing breakdown nightly dates must be strictly increasing and unique.');
    previousDate = date;
    return Object.freeze({
      date,
      amountMinor: normalizeMoneyMinor(night.amountMinor, `Night ${index + 1} amount`),
    });
  });
  const expectedAccommodationSubtotal = nightly.reduce(
    (sum, night) => sum + BigInt(night.amountMinor) * BigInt(input.quantity),
    0n,
  );
  if (expectedAccommodationSubtotal !== BigInt(price.accommodationSubtotalMinor)) {
    throw new BookingDomainValidationError('Pricing breakdown nightly prices do not equal the accommodation subtotal.');
  }

  const seenChargeIds = new Set<string>();
  const charges = input.charges.map((charge, index) => {
    const ruleId = normalizeUuid(charge.id, `Charge ${index + 1} rule ID`);
    if (seenChargeIds.has(ruleId)) throw new BookingDomainValidationError('Pricing breakdown cannot contain the same charge rule more than once.');
    seenChargeIds.add(ruleId);
    return Object.freeze({
      ruleId,
      code: normalizePricingLineCode(charge.code, `Charge ${index + 1} code`),
      name: normalizeBoundedText(charge.name, `Charge ${index + 1} name`, 120),
      kind: normalizeEnumValue(charge.kind, `Charge ${index + 1} kind`, HOSPITALITY_CHARGE_KINDS),
      calculation: normalizeEnumValue(
        charge.calculation,
        `Charge ${index + 1} calculation`,
        HOSPITALITY_CHARGE_CALCULATIONS,
      ),
      amountMinor: normalizeMoneyMinor(charge.amountMinor, `Charge ${index + 1} amount`),
    });
  });
  const taxTotalMinor = charges
    .filter((charge) => charge.kind === 'TAX')
    .reduce((sum, charge) => sum + BigInt(charge.amountMinor), 0n);
  const feeTotalMinor = charges
    .filter((charge) => charge.kind === 'FEE')
    .reduce((sum, charge) => sum + BigInt(charge.amountMinor), 0n);
  if (taxTotalMinor !== BigInt(price.taxTotalMinor) || feeTotalMinor !== BigInt(price.feeTotalMinor)) {
    throw new BookingDomainValidationError('Pricing breakdown charge lines do not equal the persisted tax and fee totals.');
  }

  const seenAddonIds = new Set<string>();
  const addons = input.addons.map((addon, index) => {
    const addonId = normalizeUuid(addon.id, `Add-on ${index + 1} ID`);
    if (seenAddonIds.has(addonId)) throw new BookingDomainValidationError('Pricing breakdown cannot contain the same add-on more than once.');
    seenAddonIds.add(addonId);
    if (!Number.isSafeInteger(addon.selectedQuantity) || addon.selectedQuantity < 1 || addon.selectedQuantity > 100) {
      throw new BookingDomainValidationError(`Add-on ${index + 1} selected quantity must be between 1 and 100.`);
    }
    return Object.freeze({
      addonId,
      code: normalizePricingLineCode(addon.code, `Add-on ${index + 1} code`),
      name: normalizeBoundedText(addon.name, `Add-on ${index + 1} name`, 120),
      pricingModel: normalizeEnumValue(
        addon.pricingModel,
        `Add-on ${index + 1} pricing model`,
        HOSPITALITY_ADDON_PRICING_MODELS,
      ),
      selectedQuantity: addon.selectedQuantity,
      amountMinor: normalizeMoneyMinor(addon.amountMinor, `Add-on ${index + 1} amount`),
    });
  });
  const addonTotalMinor = addons.reduce((sum, addon) => sum + BigInt(addon.amountMinor), 0n);
  if (addonTotalMinor !== BigInt(price.addonTotalMinor)) {
    throw new BookingDomainValidationError('Pricing breakdown add-on lines do not equal the persisted add-on total.');
  }

  return Object.freeze({
    schemaVersion: 1 as const,
    ...price,
    quantity: input.quantity,
    nightly: Object.freeze(nightly),
    charges: Object.freeze(charges),
    addons: Object.freeze(addons),
  });
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
