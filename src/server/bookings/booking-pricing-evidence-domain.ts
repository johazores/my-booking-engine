import {
  BookingDomainValidationError,
  createHospitalityPricingBreakdownSnapshot,
  type HospitalityPricingBreakdownSnapshot,
} from './booking-domain.ts';
import {
  normalizeHospitalityAddonSelections,
  type HospitalityAddonSelectionInput,
} from '../pricing/hospitality-addon-domain.ts';

export type HospitalityBookingPricingEvidenceQuote = {
  propertyId: string;
  roomTypeId: string;
  ratePlanId: string;
  arrivalDate: string;
  departureDate: string;
  quantity: number;
  currency: string;
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
  accommodationSubtotalMinor: string;
  taxTotalMinor: string;
  feeTotalMinor: string;
  addonTotalMinor: string;
  totalMinor: string;
  fingerprint: string;
};

export type HospitalityBookingPricingEvidenceCommercialState = {
  propertyId: string;
  roomTypeId: string;
  ratePlanId: string;
  arrivalDate: Date;
  departureDate: Date;
  quantity: number;
  addonSelections: HospitalityAddonSelectionInput[];
};

export class HospitalityBookingPricingEvidenceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HospitalityBookingPricingEvidenceValidationError';
  }
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HospitalityBookingPricingEvidenceValidationError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireObjectArray(value: unknown, label: string) {
  if (!Array.isArray(value)) {
    throw new HospitalityBookingPricingEvidenceValidationError(`${label} must be an array.`);
  }
  return value.map((entry, index) => requireObject(entry, `${label} item ${index + 1}`));
}

function formatDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function nextDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new HospitalityBookingPricingEvidenceValidationError('Pricing evidence contains an invalid nightly date.');
  }
  date.setUTCDate(date.getUTCDate() + 1);
  return formatDate(date);
}

function jsonValue<T>(record: Record<string, unknown>, key: string): T {
  return record[key] as T;
}

export function createHospitalityBookingPricingEvidenceBreakdown(
  quote: HospitalityBookingPricingEvidenceQuote,
): HospitalityPricingBreakdownSnapshot {
  return createHospitalityPricingBreakdownSnapshot({
    currency: quote.currency,
    quantity: quote.quantity,
    accommodationSubtotalMinor: quote.accommodationSubtotalMinor,
    taxTotalMinor: quote.taxTotalMinor,
    feeTotalMinor: quote.feeTotalMinor,
    addonTotalMinor: quote.addonTotalMinor,
    totalMinor: quote.totalMinor,
    pricingFingerprint: quote.fingerprint,
    nightly: quote.nightly,
    charges: quote.charges,
    addons: quote.addons,
  });
}

export function parseHospitalityBookingPricingEvidenceBreakdown(value: unknown): HospitalityPricingBreakdownSnapshot {
  const record = requireObject(value, 'Pricing evidence');
  if (record.schemaVersion !== 1) {
    throw new HospitalityBookingPricingEvidenceValidationError('Pricing evidence schema version is not supported.');
  }
  const nightly = requireObjectArray(record.nightly, 'Pricing evidence nightly lines');
  const charges = requireObjectArray(record.charges, 'Pricing evidence charge lines');
  const addons = requireObjectArray(record.addons, 'Pricing evidence add-on lines');

  try {
    return createHospitalityPricingBreakdownSnapshot({
      currency: jsonValue<string>(record, 'currency'),
      quantity: jsonValue<number>(record, 'quantity'),
      accommodationSubtotalMinor: jsonValue<string>(record, 'accommodationSubtotalMinor'),
      taxTotalMinor: jsonValue<string>(record, 'taxTotalMinor'),
      feeTotalMinor: jsonValue<string>(record, 'feeTotalMinor'),
      addonTotalMinor: jsonValue<string>(record, 'addonTotalMinor'),
      totalMinor: jsonValue<string>(record, 'totalMinor'),
      pricingFingerprint: jsonValue<string>(record, 'pricingFingerprint'),
      nightly: nightly.map((line) => ({
        date: jsonValue<string>(line, 'date'),
        amountMinor: jsonValue<string>(line, 'amountMinor'),
      })),
      charges: charges.map((line) => ({
        id: jsonValue<string>(line, 'ruleId'),
        code: jsonValue<string>(line, 'code'),
        name: jsonValue<string>(line, 'name'),
        kind: jsonValue<string>(line, 'kind'),
        calculation: jsonValue<string>(line, 'calculation'),
        amountMinor: jsonValue<string>(line, 'amountMinor'),
      })),
      addons: addons.map((line) => ({
        id: jsonValue<string>(line, 'addonId'),
        code: jsonValue<string>(line, 'code'),
        name: jsonValue<string>(line, 'name'),
        pricingModel: jsonValue<string>(line, 'pricingModel'),
        selectedQuantity: jsonValue<number>(line, 'selectedQuantity'),
        amountMinor: jsonValue<string>(line, 'amountMinor'),
      })),
    });
  } catch (error) {
    if (error instanceof BookingDomainValidationError) {
      throw new HospitalityBookingPricingEvidenceValidationError(error.message);
    }
    throw error;
  }
}

export function assertHospitalityBookingPricingEvidenceMatchesCommercialState(input: {
  breakdown: HospitalityPricingBreakdownSnapshot;
  state: HospitalityBookingPricingEvidenceCommercialState;
}) {
  const { breakdown, state } = input;
  if (breakdown.quantity !== state.quantity) {
    throw new HospitalityBookingPricingEvidenceValidationError('Pricing evidence room quantity does not match the commercial state.');
  }
  const firstNight = breakdown.nightly[0];
  const lastNight = breakdown.nightly.at(-1);
  if (!firstNight || !lastNight || firstNight.date !== formatDate(state.arrivalDate) || nextDate(lastNight.date) !== formatDate(state.departureDate)) {
    throw new HospitalityBookingPricingEvidenceValidationError('Pricing evidence nightly dates do not match the commercial stay.');
  }

  const selections = normalizeHospitalityAddonSelections(state.addonSelections);
  const evidenceSelections = breakdown.addons
    .map((addon) => ({ addonId: addon.addonId, quantity: addon.selectedQuantity }))
    .sort((left, right) => left.addonId.localeCompare(right.addonId));
  if (
    selections.length !== evidenceSelections.length
    || selections.some((selection, index) => {
      const evidence = evidenceSelections[index];
      return !evidence || evidence.addonId !== selection.addonId || evidence.quantity !== selection.quantity;
    })
  ) {
    throw new HospitalityBookingPricingEvidenceValidationError('Pricing evidence add-on selections do not match the commercial state.');
  }
}

export function assertHospitalityBookingPricingQuoteMatchesCommercialState(input: {
  quote: HospitalityBookingPricingEvidenceQuote;
  state: HospitalityBookingPricingEvidenceCommercialState;
}) {
  const { quote, state } = input;
  if (
    quote.propertyId !== state.propertyId
    || quote.roomTypeId !== state.roomTypeId
    || quote.ratePlanId !== state.ratePlanId
    || quote.arrivalDate !== formatDate(state.arrivalDate)
    || quote.departureDate !== formatDate(state.departureDate)
    || quote.quantity !== state.quantity
  ) {
    throw new HospitalityBookingPricingEvidenceValidationError('Transactional pricing quote does not match the commercial state.');
  }
  const breakdown = createHospitalityBookingPricingEvidenceBreakdown(quote);
  assertHospitalityBookingPricingEvidenceMatchesCommercialState({ breakdown, state });
  return breakdown;
}
