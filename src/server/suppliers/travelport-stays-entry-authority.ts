import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import {
  TravelportStaysConfigurationError,
  type TravelportStaysCredentials,
} from './travelport-stays-provider-core.ts';

export type TravelportStaysConfigurationAuthority = Readonly<{
  environment: unknown;
  username: unknown;
  password: unknown;
  clientId: unknown;
  clientSecret: unknown;
  accessGroup: unknown;
}>;

function invalidEntryAuthority(): never {
  throw new HospitalitySupplierProviderError(
    'INVALID_REQUEST',
    'Travelport provider entry authority could not be materialized safely.',
  );
}

function invalidConfigurationAuthority(): never {
  throw new TravelportStaysConfigurationError(
    'Travelport configuration authority could not be materialized safely.',
  );
}

function providerMaterialize<T>(read: () => T): T {
  try {
    return read();
  } catch {
    invalidEntryAuthority();
  }
}

function credentialsSnapshot(value: unknown): TravelportStaysCredentials {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalidEntryAuthority();
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

export function materializeTravelportStaysConfigurationAuthority(
  input: unknown,
): TravelportStaysConfigurationAuthority {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      invalidConfigurationAuthority();
    }
    const source = input as Readonly<Record<string, unknown>>;
    return Object.freeze({
      environment: source.environment,
      username: source.username,
      password: source.password,
      clientId: source.clientId,
      clientSecret: source.clientSecret,
      accessGroup: source.accessGroup,
    });
  } catch {
    invalidConfigurationAuthority();
  }
}

export function materializeTravelportStaysAccessTokenAuthority(
  input: Readonly<{
    credentials: TravelportStaysCredentials;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    nowMs?: number;
  }>,
) {
  return providerMaterialize(() => Object.freeze({
    credentials: credentialsSnapshot(input.credentials),
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
    nowMs: input.nowMs,
  }));
}

export function materializeTravelportStaysHealthProbeAuthority(
  input: Readonly<{
    credentials: TravelportStaysCredentials;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  }>,
) {
  return providerMaterialize(() => Object.freeze({
    credentials: credentialsSnapshot(input.credentials),
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
  }));
}
