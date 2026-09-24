import { createHash } from 'node:crypto';

import {
  normalizeRentalCode,
  normalizeRentalDateRange,
  RentalInventoryValidationError,
} from './rental-domain.ts';
import {
  INVENTORY_PAGE_SIZE_DEFAULT,
  INVENTORY_PAGE_SIZE_MAX,
} from './inventory-pagination.ts';

const MILLISECONDS_PER_DAY = 86_400_000;
const MAX_RENTAL_AVAILABILITY_DAYS = 90;

export class RentalAvailabilityIntegrityError extends Error {
  constructor(message = 'Rental availability pricing data is inconsistent.') {
    super(message);
    this.name = 'RentalAvailabilityIntegrityError';
  }
}

export type RentalAvailabilitySearchInput = Readonly<{
  unitTypeCode: string;
  locationCode?: string;
  startsOn: string;
  endsOn: string;
  page?: string | number;
  pageSize?: string | number;
}>;

export type RentalRatePeriodEvidence = Readonly<{
  startsOn: Date;
  endsOn: Date;
  dailyRateMinor: number;
}>;

function normalizePositiveInteger(value: string | number | undefined, fallback: number, field: string, maximum: number) {
  if (value === undefined || value === '') return fallback;
  const normalized = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1 || normalized > maximum) {
    throw new RentalInventoryValidationError(`${field} is invalid.`);
  }
  return normalized;
}

function localDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function assertSafeDailyRate(value: number) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RentalAvailabilityIntegrityError('Rental daily pricing must use positive integer minor units.');
  }
}

export function normalizeRentalAvailabilitySearchInput(input: RentalAvailabilitySearchInput) {
  const dateRange = normalizeRentalDateRange(input);
  const days = (dateRange.endsOn.getTime() - dateRange.startsOn.getTime()) / MILLISECONDS_PER_DAY;
  if (days > MAX_RENTAL_AVAILABILITY_DAYS) {
    throw new RentalInventoryValidationError(
      `Rental availability previews cannot exceed ${MAX_RENTAL_AVAILABILITY_DAYS} days.`,
    );
  }

  const rawLocationCode = input.locationCode?.trim() ?? '';
  return Object.freeze({
    unitTypeCode: normalizeRentalCode(input.unitTypeCode),
    locationCode: rawLocationCode ? normalizeRentalCode(rawLocationCode) : null,
    startsOn: dateRange.startsOn,
    endsOn: dateRange.endsOn,
    page: normalizePositiveInteger(input.page, 1, 'Page', 10_000),
    pageSize: normalizePositiveInteger(
      input.pageSize,
      INVENTORY_PAGE_SIZE_DEFAULT,
      'Page size',
      INVENTORY_PAGE_SIZE_MAX,
    ),
    days,
  });
}

export function buildRentalRateQuote(input: Readonly<{
  startsOn: Date;
  endsOn: Date;
  defaultDailyRateMinor: number;
  ratePeriods: readonly RentalRatePeriodEvidence[];
}>) {
  assertSafeDailyRate(input.defaultDailyRateMinor);
  const days = (input.endsOn.getTime() - input.startsOn.getTime()) / MILLISECONDS_PER_DAY;
  if (!Number.isSafeInteger(days) || days < 1 || days > MAX_RENTAL_AVAILABILITY_DAYS) {
    throw new RentalAvailabilityIntegrityError('Rental pricing range is invalid.');
  }

  const ratePeriods = [...input.ratePeriods]
    .map((period) => {
      assertSafeDailyRate(period.dailyRateMinor);
      if (
        !Number.isFinite(period.startsOn.getTime())
        || !Number.isFinite(period.endsOn.getTime())
        || period.startsOn >= period.endsOn
      ) {
        throw new RentalAvailabilityIntegrityError('Rental pricing period is invalid.');
      }
      return period;
    })
    .sort((left, right) => left.startsOn.getTime() - right.startsOn.getTime());

  for (let index = 1; index < ratePeriods.length; index += 1) {
    const previous = ratePeriods[index - 1];
    const current = ratePeriods[index];
    if (previous && current && current.startsOn < previous.endsOn) {
      throw new RentalAvailabilityIntegrityError('Rental pricing periods overlap.');
    }
  }

  type Segment = {
    startsOn: string;
    endsOn: string;
    dailyRateMinor: number;
    source: 'default' | 'override';
  };

  const segments: Segment[] = [];
  let totalMinor = 0;

  for (let offset = 0; offset < days; offset += 1) {
    const dayStart = new Date(input.startsOn.getTime() + offset * MILLISECONDS_PER_DAY);
    const dayEnd = new Date(dayStart.getTime() + MILLISECONDS_PER_DAY);
    const override = ratePeriods.find((period) => period.startsOn <= dayStart && period.endsOn > dayStart);
    const dailyRateMinor = override?.dailyRateMinor ?? input.defaultDailyRateMinor;
    const source = override ? 'override' as const : 'default' as const;
    if (!Number.isSafeInteger(totalMinor + dailyRateMinor)) {
      throw new RentalAvailabilityIntegrityError('Rental pricing total exceeds safe integer limits.');
    }
    totalMinor += dailyRateMinor;

    const previous = segments.at(-1);
    if (previous && previous.dailyRateMinor === dailyRateMinor && previous.source === source && previous.endsOn === localDate(dayStart)) {
      previous.endsOn = localDate(dayEnd);
      continue;
    }
    segments.push({
      startsOn: localDate(dayStart),
      endsOn: localDate(dayEnd),
      dailyRateMinor,
      source,
    });
  }

  return Object.freeze({
    days,
    totalMinor,
    segments: Object.freeze(segments.map((segment) => Object.freeze({ ...segment }))),
  });
}

export function buildRentalPricingEvidence(input: Readonly<{
  unitTypeId: string;
  currency: string;
  startsOn: Date;
  endsOn: Date;
  defaultDailyRateMinor: number;
  ratePeriods: readonly RentalRatePeriodEvidence[];
}>) {
  const unitTypeId = input.unitTypeId.trim();
  if (!unitTypeId || unitTypeId.length > 120) {
    throw new RentalAvailabilityIntegrityError('Rental pricing unit type identity is invalid.');
  }
  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new RentalAvailabilityIntegrityError('Rental pricing currency is invalid.');
  }

  const quote = buildRentalRateQuote({
    startsOn: input.startsOn,
    endsOn: input.endsOn,
    defaultDailyRateMinor: input.defaultDailyRateMinor,
    ratePeriods: input.ratePeriods,
  });
  const snapshot = {
    version: 1,
    unitTypeId,
    currency,
    startsOn: localDate(input.startsOn),
    endsOn: localDate(input.endsOn),
    days: quote.days,
    totalMinor: quote.totalMinor,
    segments: quote.segments.map((segment) => ({ ...segment })),
  };
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(snapshot))
    .digest('hex');

  return Object.freeze({
    currency,
    totalMinor: quote.totalMinor,
    fingerprint,
    snapshot: Object.freeze({
      ...snapshot,
      segments: Object.freeze(snapshot.segments.map((segment) => Object.freeze(segment))),
    }),
    quote,
  });
}
