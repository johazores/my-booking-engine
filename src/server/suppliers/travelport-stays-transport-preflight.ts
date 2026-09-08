import type { TravelportStaysCredentials } from './travelport-stays-provider.ts';
import { createTravelportStaysTraceFetch } from './travelport-stays-trace-fetch.ts';

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
  const preflightFetch = createTravelportStaysTraceFetch({
    environment: input.credentials.environment,
    credentials: input.credentials,
    fetchImpl: noIoTravelportStaysPreflightFetch,
  });
  await preflightFetch(input.requestInput, input.init);
}
