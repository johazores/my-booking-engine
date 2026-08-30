import type { FlightSearchRequest, FlightSearchResult } from '@/src/domain/flight-search';
import type { FlightSearchProvider } from '@/src/integrations/travel/flight-search-provider';
import { rapidApiFlightProvider } from '@/src/integrations/travel/rapid-api-flight-provider';

export class FlightSearchValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super('Invalid flight search request.');
    this.name = 'FlightSearchValidationError';
    this.issues = issues;
  }
}

const firstValue = (value: unknown): unknown => (Array.isArray(value) ? value[0] : value);

const requiredString = (value: unknown): string => {
  const candidate = firstValue(value);
  return typeof candidate === 'string' ? candidate.trim() : '';
};

const isIsoDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

export const parseFlightSearchRequest = (
  input: { [key: string]: unknown },
): FlightSearchRequest => {
  const origin = requiredString(input.origin).toUpperCase();
  const destination = requiredString(input.destination).toUpperCase();
  const departureDate = requiredString(input.departureDate);
  const returnDate = requiredString(input.returnDate || input.returningDate);
  const adultsValue = requiredString(input.adults || input.persons);
  const adults = Number(adultsValue);
  const issues: string[] = [];

  if (!/^[A-Z]{3}$/.test(origin)) {
    issues.push('Origin must be a valid three-letter airport code.');
  }

  if (!/^[A-Z]{3}$/.test(destination)) {
    issues.push('Destination must be a valid three-letter airport code.');
  }

  if (origin && destination && origin === destination) {
    issues.push('Origin and destination must be different.');
  }

  if (!isIsoDate(departureDate)) {
    issues.push('Departure date must use YYYY-MM-DD format.');
  }

  if (returnDate && !isIsoDate(returnDate)) {
    issues.push('Return date must use YYYY-MM-DD format.');
  }

  if (returnDate && departureDate && returnDate < departureDate) {
    issues.push('Return date cannot be before departure date.');
  }

  if (!Number.isInteger(adults) || adults < 1 || adults > 9) {
    issues.push('Adults must be a whole number between 1 and 9.');
  }

  if (issues.length) {
    throw new FlightSearchValidationError(issues);
  }

  return {
    origin,
    destination,
    departureDate,
    ...(returnDate ? { returnDate } : {}),
    adults,
  };
};

export const searchFlights = async (
  request: FlightSearchRequest,
  provider: FlightSearchProvider = rapidApiFlightProvider,
): Promise<FlightSearchResult> => provider.search(request);
