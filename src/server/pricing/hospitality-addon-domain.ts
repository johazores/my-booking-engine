import { parseAvailabilityDate } from '../availability/availability-domain.ts';
import { requirePricingText } from './pricing-boundary.ts';
import { multiplyMoneyMinor, parseMoneyMajorToMinor, PricingValidationError } from './money.ts';

export type HospitalityAddonPricingModel = 'PER_BOOKING' | 'PER_ROOM' | 'PER_ROOM_NIGHT' | 'PER_UNIT';

export type HospitalityAddonInput = {
  propertyId: string;
  roomTypeId: string;
  ratePlanId: string;
  name: string;
  code: string;
  description: string;
  pricingModel: string;
  amount: string;
  maxQuantity: string | number;
  startDate: string;
  endDate: string;
};

export type HospitalityAddonSelectionInput = {
  addonId: string;
  quantity: number;
};

const MAX_ADDON_QUANTITY = 100;
const MAX_SELECTED_ADDONS = 25;

function requiredText(value: string, label: string, maxLength: number) {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > maxLength) throw new PricingValidationError(`${label} must be between 1 and ${maxLength} characters.`);
  return normalized;
}

function optionalText(value: string, maxLength: number) {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length > maxLength) throw new PricingValidationError(`Description must be no more than ${maxLength} characters.`);
  return normalized || null;
}

function addonCode(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(normalized)) throw new PricingValidationError('Add-on code must use 1-32 letters, numbers, underscores, or hyphens.');
  return normalized;
}

function pricingModel(value: string): HospitalityAddonPricingModel {
  const normalized = value.trim().toUpperCase();
  if (!['PER_BOOKING', 'PER_ROOM', 'PER_ROOM_NIGHT', 'PER_UNIT'].includes(normalized)) throw new PricingValidationError('Add-on pricing model is not supported.');
  return normalized as HospitalityAddonPricingModel;
}

function addonQuantity(value: string | number) {
  if (typeof value !== 'string' && typeof value !== 'number') throw new PricingValidationError(`Add-on maximum quantity must be between 1 and ${MAX_ADDON_QUANTITY}.`);
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) throw new PricingValidationError(`Add-on maximum quantity must be between 1 and ${MAX_ADDON_QUANTITY}.`);
  const parsed = typeof value === 'number' ? value : Number(value.trim());
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_ADDON_QUANTITY) throw new PricingValidationError(`Add-on maximum quantity must be between 1 and ${MAX_ADDON_QUANTITY}.`);
  return parsed;
}

export function normalizeHospitalityAddonInput(input: HospitalityAddonInput, currency: string) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PricingValidationError('Add-on input must be an object.');
  const roomTypeId = requirePricingText(input.roomTypeId, 'Room type ID').trim() || null;
  const ratePlanId = requirePricingText(input.ratePlanId, 'Rate plan ID').trim() || null;
  if ((roomTypeId === null) !== (ratePlanId === null)) throw new PricingValidationError('Add-on scope must be property-wide or use both a room type and rate plan.');
  const startDate = parseAvailabilityDate(requirePricingText(input.startDate, 'Start date'), 'Start date');
  const endDate = parseAvailabilityDate(requirePricingText(input.endDate, 'End date'), 'End date');
  if (endDate < startDate) throw new PricingValidationError('End date must be on or after start date.');
  const money = parseMoneyMajorToMinor(requirePricingText(input.amount, 'Add-on amount'), currency);
  if (money.amountMinor <= 0n) throw new PricingValidationError('Add-on amount must be greater than zero.');
  const model = pricingModel(requirePricingText(input.pricingModel, 'Add-on pricing model'));
  const maxQuantity = addonQuantity(input.maxQuantity);
  if (model !== 'PER_UNIT' && maxQuantity !== 1) throw new PricingValidationError('Only per-unit add-ons may configure a maximum quantity greater than one.');

  return {
    propertyId: requirePricingText(input.propertyId, 'Property ID').trim(),
    roomTypeId,
    ratePlanId,
    name: requiredText(requirePricingText(input.name, 'Add-on name'), 'Add-on name', 120),
    code: addonCode(requirePricingText(input.code, 'Add-on code')),
    description: optionalText(requirePricingText(input.description, 'Add-on description'), 300),
    pricingModel: model,
    amountMinor: money.amountMinor,
    currency: money.currency,
    maxQuantity,
    startDate,
    endDate,
  };
}

export function normalizeHospitalityAddonSelections(input: unknown) {
  if (!Array.isArray(input) || input.length > MAX_SELECTED_ADDONS) throw new PricingValidationError(`A quote may include no more than ${MAX_SELECTED_ADDONS} add-ons.`);
  const seen = new Set<string>();
  const selections: unknown[] = input;
  return selections.map((selection) => {
    if (!selection || typeof selection !== 'object' || Array.isArray(selection) || !('addonId' in selection) || typeof selection.addonId !== 'string') {
      throw new PricingValidationError('Selected add-on identifier is invalid.');
    }
    const addonId = selection.addonId.trim().toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(addonId)) throw new PricingValidationError('Selected add-on identifier is invalid.');
    if (seen.has(addonId)) throw new PricingValidationError('The same add-on cannot be selected more than once.');
    if (!('quantity' in selection) || typeof selection.quantity !== 'number' || !Number.isSafeInteger(selection.quantity) || selection.quantity < 1 || selection.quantity > MAX_ADDON_QUANTITY) throw new PricingValidationError(`Selected add-on quantity must be between 1 and ${MAX_ADDON_QUANTITY}.`);
    seen.add(addonId);
    return { addonId, quantity: selection.quantity };
  }).sort((left, right) => left.addonId.localeCompare(right.addonId));
}

export function hospitalityAddonAmountMinor(input: {
  amountMinor: bigint;
  pricingModel: HospitalityAddonPricingModel;
  selectedQuantity: number;
  roomQuantity: number;
  stayNights: number;
  maxQuantity: number;
}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PricingValidationError('Add-on calculation input must be an object.');
  if (typeof input.amountMinor !== 'bigint' || input.amountMinor <= 0n) throw new PricingValidationError('Add-on amount must be a positive bigint.');
  if (!Number.isSafeInteger(input.maxQuantity) || input.maxQuantity < 1 || input.maxQuantity > MAX_ADDON_QUANTITY) throw new PricingValidationError('Add-on maximum quantity is outside the supported range.');
  if (!['PER_BOOKING', 'PER_ROOM', 'PER_ROOM_NIGHT', 'PER_UNIT'].includes(input.pricingModel)) {
    throw new PricingValidationError('Add-on pricing model is not supported.');
  }
  for (const [label, value, max] of [
    ['selected quantity', input.selectedQuantity, input.maxQuantity],
    ['room quantity', input.roomQuantity, 50],
    ['stay nights', input.stayNights, 366],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new PricingValidationError(`Add-on ${label} is outside the supported range.`);
  }

  if (input.pricingModel !== 'PER_UNIT' && input.selectedQuantity !== 1) throw new PricingValidationError('Only per-unit add-ons accept a selected quantity greater than one.');
  const multiplier = input.pricingModel === 'PER_UNIT'
    ? input.selectedQuantity
    : input.pricingModel === 'PER_ROOM'
      ? input.roomQuantity
      : input.pricingModel === 'PER_ROOM_NIGHT'
        ? input.roomQuantity * input.stayNights
        : 1;
  return multiplyMoneyMinor(input.amountMinor, multiplier);
}
