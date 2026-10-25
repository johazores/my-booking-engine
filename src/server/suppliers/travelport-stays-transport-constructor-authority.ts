import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';

/** Frozen, allowlisted constructor evidence for both Travelport outbound transports. */
export type TravelportStaysTransportCredentialAuthority = Readonly<{
  username: string;
  password: string;
  clientId: string;
  clientSecret: string;
  accessGroup: string;
}>;

export function materializeTravelportStaysTransportConstructorAuthority<TEnvironment extends string>(
  input: Readonly<{
    environment: TEnvironment;
    credentials?: TravelportStaysTransportCredentialAuthority;
    fetchImpl?: typeof fetch;
  }>,
): Readonly<{
  environment: TEnvironment;
  credentials: TravelportStaysTransportCredentialAuthority | undefined;
  fetchImpl: typeof fetch;
}> {
  try {
    const environment = input.environment;
    const source = input.credentials;
    const suppliedFetch = input.fetchImpl;
    if (source !== undefined && (!source || typeof source !== 'object' || Array.isArray(source))) {
      throw new Error('Invalid credential container');
    }
    const credentials = source === undefined ? undefined : Object.freeze({
      username: source.username,
      password: source.password,
      clientId: source.clientId,
      clientSecret: source.clientSecret,
      accessGroup: source.accessGroup,
    });
    if (
      (credentials && Object.values(credentials).some((value) => typeof value !== 'string'))
      || (suppliedFetch !== undefined && typeof suppliedFetch !== 'function')
    ) {
      throw new Error('Invalid transport constructor field');
    }
    return Object.freeze({
      environment,
      credentials,
      fetchImpl: suppliedFetch ?? fetch,
    });
  } catch {
    throw new HospitalitySupplierProviderError(
      'INVALID_REQUEST',
      'Travelport transport constructor authority could not be materialized safely.',
    );
  }
}
