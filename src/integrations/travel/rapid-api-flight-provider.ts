import type {
  FlightLeg,
  FlightOffer,
  FlightSearchRequest,
  FlightSearchResult,
  FlightSegment,
} from '@/src/domain/flight-search';
import type { FlightSearchProvider } from '@/src/integrations/travel/flight-search-provider';

type UnknownRecord = Record<string, unknown>;

export type FlightProviderErrorCode =
  | 'configuration'
  | 'authentication'
  | 'rate-limit'
  | 'timeout'
  | 'upstream'
  | 'invalid-response';

export class FlightProviderError extends Error {
  readonly code: FlightProviderErrorCode;
  readonly providerId: string;
  readonly status?: number;

  constructor(
    providerId: string,
    code: FlightProviderErrorCode,
    message: string,
    status?: number,
  ) {
    super(message);
    this.name = 'FlightProviderError';
    this.providerId = providerId;
    this.code = code;
    this.status = status;
  }
}

const PROVIDER_ID = 'rapidapi-skyscanner';
const REQUEST_TIMEOUT_MS = 15_000;

const asRecord = (value: unknown): UnknownRecord | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as UnknownRecord;
};

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const asString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const asNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const getNestedString = (record: UnknownRecord | null, key: string): string | null =>
  record ? asString(record[key]) : null;

const normalizeSegment = (
  value: unknown,
  offerId: string,
  legIndex: number,
  segmentIndex: number,
): FlightSegment | null => {
  const segment = asRecord(value);
  if (!segment) {
    return null;
  }

  const destination = asRecord(segment.destination);
  const destinationCode =
    getNestedString(destination, 'displayCode') ??
    getNestedString(destination, 'flightPlaceId') ??
    '';

  return {
    id: asString(segment.id) ?? `${offerId}-leg-${legIndex}-segment-${segmentIndex}`,
    durationMinutes: asNumber(segment.durationInMinutes) ?? 0,
    destinationCode,
  };
};

const normalizeLeg = (
  value: unknown,
  offerId: string,
  legIndex: number,
): FlightLeg | null => {
  const leg = asRecord(value);
  if (!leg) {
    return null;
  }

  const origin = asRecord(leg.origin);
  const destination = asRecord(leg.destination);
  const departureAt = asString(leg.departure);
  const arrivalAt = asString(leg.arrival);
  const originCode = getNestedString(origin, 'displayCode');
  const destinationCode = getNestedString(destination, 'displayCode');

  if (!departureAt || !arrivalAt || !originCode || !destinationCode) {
    return null;
  }

  const segments = asArray(leg.segments)
    .map((segment, segmentIndex) => normalizeSegment(segment, offerId, legIndex, segmentIndex))
    .filter((segment): segment is FlightSegment => Boolean(segment));

  return {
    id: asString(leg.id) ?? `${offerId}-leg-${legIndex}`,
    departureAt,
    arrivalAt,
    originCode,
    destinationCode,
    durationMinutes: asNumber(leg.durationInMinutes) ?? 0,
    stopCount: asNumber(leg.stopCount) ?? Math.max(segments.length - 1, 0),
    segments,
  };
};

const normalizeOffer = (value: unknown, index: number): FlightOffer | null => {
  const offer = asRecord(value);
  if (!offer) {
    return null;
  }

  const offerId = asString(offer.id) ?? `${PROVIDER_ID}-offer-${index}`;
  const legs = asArray(offer.legs)
    .map((leg, legIndex) => normalizeLeg(leg, offerId, legIndex))
    .filter((leg): leg is FlightLeg => Boolean(leg));

  const pricingOption = asRecord(asArray(offer.pricing_options)[0]);
  const price = asRecord(pricingOption?.price);
  const amount = asNumber(price?.amount);
  const currency =
    asString(price?.currency) ??
    asString(pricingOption?.currency) ??
    asString(offer.currency) ??
    'USD';

  if (!legs.length || amount === null) {
    return null;
  }

  return {
    id: offerId,
    providerId: PROVIDER_ID,
    legs,
    totalPrice: {
      amount,
      currency,
    },
  };
};

const normalizeSearchResponse = (payload: unknown): FlightSearchResult => {
  const root = asRecord(payload);
  const itineraries = asRecord(root?.itineraries);
  const rawOffers = asArray(itineraries?.results);

  return {
    providerId: PROVIDER_ID,
    offers: rawOffers
      .map((offer, index) => normalizeOffer(offer, index))
      .filter((offer): offer is FlightOffer => Boolean(offer)),
  };
};

const getConfiguration = () => {
  const host = process.env.RAPID_API_HOST?.trim();
  const key = process.env.RAPID_API_KEY?.trim();

  if (!host || !key) {
    throw new FlightProviderError(
      PROVIDER_ID,
      'configuration',
      'Flight search provider is not configured.',
    );
  }

  return { host, key };
};

const classifyHttpError = (status: number): FlightProviderErrorCode => {
  if (status === 401 || status === 403) {
    return 'authentication';
  }

  if (status === 429) {
    return 'rate-limit';
  }

  return 'upstream';
};

export const rapidApiFlightProvider: FlightSearchProvider = {
  id: PROVIDER_ID,
  capabilities: ['flight-search'],

  async search(request: FlightSearchRequest): Promise<FlightSearchResult> {
    const { host, key } = getConfiguration();
    const url = new URL(`https://${host}/search-extended`);
    url.searchParams.set('adults', String(request.adults));
    url.searchParams.set('origin', request.origin);
    url.searchParams.set('destination', request.destination);
    url.searchParams.set('departureDate', request.departureDate);

    if (request.returnDate) {
      url.searchParams.set('returnDate', request.returnDate);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-RapidAPI-Key': key,
          'X-RapidAPI-Host': host,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new FlightProviderError(
          PROVIDER_ID,
          classifyHttpError(response.status),
          'Flight search provider rejected the request.',
          response.status,
        );
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new FlightProviderError(
          PROVIDER_ID,
          'invalid-response',
          'Flight search provider returned an invalid response.',
        );
      }

      return normalizeSearchResponse(payload);
    } catch (error) {
      if (error instanceof FlightProviderError) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new FlightProviderError(
          PROVIDER_ID,
          'timeout',
          'Flight search provider timed out.',
        );
      }

      throw new FlightProviderError(
        PROVIDER_ID,
        'upstream',
        'Flight search provider is unavailable.',
      );
    } finally {
      clearTimeout(timeout);
    }
  },
};
