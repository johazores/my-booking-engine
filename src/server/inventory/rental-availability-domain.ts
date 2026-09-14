import {
  normalizeRentalCode,
  normalizeRentalDateRange,
  RentalInventoryValidationError,
} from './rental-domain.ts';

const MILLISECONDS_PER_DAY = 86_400_000;
const MAX_RENTAL_AVAILABILITY_DAYS = 90;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

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
    pageSize: normalizePositiveInteger(input.pageSize, DEFAULT_PAGE_SIZE, 'Page size', MAX_PAGE_SIZE),
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
