import type { TravelportStaysCredentials } from './travelport-stays-provider.ts';
import { createTravelportStaysOAuthCredentialContainmentFetch } from './travelport-stays-oauth-credential-containment-fetch.ts';
import { createTravelportStaysTraceFetch } from './travelport-stays-trace-fetch.ts';
import { materializeTravelportStaysAccessTokenAuthority } from './travelport-stays-entry-authority.ts';
import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';

const noIoTravelportStaysPreflightFetch = (async () => new Response(null, { status: 204 })) as typeof fetch;

/**
 * Runs the exact credentialed Travelport transport policy without network I/O.
 * Provider-write executors use this before their durable provider-request marker,
 * while the real shared transport validates the request again when the POST runs.
 */
export async function assertTravelportStaysTransportRequestReady(input: Readonly<{
  credentials: TravelportStaysCredentials;
  requestInput: RequestInfo | URL;
  init?: RequestInit;
}>): Promise<void> {
  // The preflight must use the same one-read credential/environment evidence.
  let credentials: TravelportStaysCredentials;
  let requestInput: RequestInfo | URL;
  let init: RequestInit | undefined;
  try {
    const sourceCredentials = input.credentials;
    credentials = materializeTravelportStaysAccessTokenAuthority({ credentials: sourceCredentials }).credentials;
    requestInput = input.requestInput;
    init = input.init;
  } catch {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Travelport preflight authority is invalid.');
  }
  // Mirror both credentialed production transport layers before a durable
  // provider-write marker. A trace-only check can miss terminal containment
  // policy changes and strand a safe, unsubmitted write as ambiguous.
  const credentialContainedFetch = createTravelportStaysOAuthCredentialContainmentFetch({
    environment: credentials.environment,
    credentials,
    fetchImpl: noIoTravelportStaysPreflightFetch,
  });
  const preflightFetch = createTravelportStaysTraceFetch({
    environment: credentials.environment,
    credentials,
    fetchImpl: credentialContainedFetch,
  });
  await preflightFetch(requestInput, init);
}
