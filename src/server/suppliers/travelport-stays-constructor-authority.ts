import type { HospitalitySupplierBookingTermsProvider } from './hospitality-supplier-booking-terms.ts';
import {
  HospitalitySupplierProviderError,
  type HospitalitySupplierPricingProvider,
} from './hospitality-supplier-provider.ts';
import type { TravelportStaysCredentials } from './travelport-stays-provider-core.ts';

function invalidConstructorAuthority(): never {
  throw new HospitalitySupplierProviderError(
    'INVALID_REQUEST',
    'Travelport provider constructor authority could not be materialized safely.',
  );
}

function materialize<T>(read: () => T): T {
  try {
    return read();
  } catch {
    invalidConstructorAuthority();
  }
}

function credentialsSnapshot(value: unknown): TravelportStaysCredentials {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalidConstructorAuthority();
  }
  const credentials = value as Readonly<Record<string, unknown>>;
  return Object.freeze({
    environment: credentials.environment,
    username: credentials.username,
    password: credentials.password,
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    accessGroup: credentials.accessGroup,
  }) as TravelportStaysCredentials;
}

export function materializeTravelportStaysProviderConstructorAuthority(
  input: Readonly<{
    credentials: TravelportStaysCredentials;
    cacheKey: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    now?: () => Date;
  }>,
) {
  return materialize(() => Object.freeze({
    credentials: credentialsSnapshot(input.credentials),
    cacheKey: input.cacheKey,
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
    now: input.now,
  }));
}

export function materializeTravelportStaysBookingTermsConstructorAuthority(
  input: Readonly<{
    credentials: TravelportStaysCredentials;
    cacheKey: string;
    pricingProvider: HospitalitySupplierPricingProvider;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    now?: () => Date;
  }>,
) {
  return materialize(() => Object.freeze({
    credentials: credentialsSnapshot(input.credentials),
    cacheKey: input.cacheKey,
    pricingProvider: input.pricingProvider,
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
    now: input.now,
  }));
}

export function materializeTravelportStaysReservationAuthorityConstructorAuthority(
  input: Readonly<{
    credentials: TravelportStaysCredentials;
    cacheKey: string;
    bookingTermsProvider: HospitalitySupplierBookingTermsProvider;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    now?: () => Date;
  }>,
) {
  return materialize(() => Object.freeze({
    credentials: credentialsSnapshot(input.credentials),
    cacheKey: input.cacheKey,
    bookingTermsProvider: input.bookingTermsProvider,
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
    now: input.now,
  }));
}

export function materializeTravelportStaysReservationIoConstructorAuthority(
  input: Readonly<{
    credentials: TravelportStaysCredentials;
    cacheKey: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    now?: () => Date;
  }>,
) {
  return materialize(() => Object.freeze({
    credentials: credentialsSnapshot(input.credentials),
    cacheKey: input.cacheKey,
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
    now: input.now,
  }));
}
