import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';

const TRAVELPORT_STAYS_API_HOSTS = new Set([
  'api.pp.travelport.net',
  'api.travelport.net',
]);
const AVAILABILITY_PATH = '/11/hotel/availability/catalogofferingshospitality';
const RULES_PATH = '/11/hotel/rules/offershospitality/buildfromrequest';
const SEARCH_COMPLETE_PATH = '/12/hotel/search/searchcomplete';

type JsonRecord = Readonly<Record<string, unknown>>;

function invalidRequest(): never {
  throw new HospitalitySupplierProviderError(
    'INVALID_REQUEST',
    'Travelport Stays request authority contains ill-formed Unicode.',
  );
}

function invalidResponse(): never {
  throw new HospitalitySupplierProviderError(
    'INVALID_RESPONSE',
    'Travelport Stays returned ill-formed Unicode authority evidence.',
  );
}

function requestUrl(input: Parameters<typeof fetch>[0]): URL | null {
  const value = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function targetsPreWriteStaysJson(url: URL | null): boolean {
  if (
    !url
    || url.protocol !== 'https:'
    || url.port !== ''
    || url.username !== ''
    || url.password !== ''
    || !TRAVELPORT_STAYS_API_HOSTS.has(url.hostname)
  ) return false;

  return url.pathname === SEARCH_COMPLETE_PATH
    || url.pathname === RULES_PATH
    || url.pathname === AVAILABILITY_PATH
    || url.pathname.startsWith(`${AVAILABILITY_PATH}/`);
}

function assertWellFormedJsonStrings(
  value: unknown,
  failure: 'request' | 'response',
): void {
  const stack: unknown[] = [value];

  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current === 'string') {
      if (!current.isWellFormed()) {
        if (failure === 'request') invalidRequest();
        invalidResponse();
      }
      continue;
    }

    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }

    if (!current || typeof current !== 'object') continue;
    for (const [key, item] of Object.entries(current as JsonRecord)) {
      if (!key.isWellFormed()) {
        if (failure === 'request') invalidRequest();
        invalidResponse();
      }
      stack.push(item);
    }
  }
}

function inspectRequestBodyIfMaterialized(
  init?: Parameters<typeof fetch>[1],
): void {
  if (typeof init?.body !== 'string') return;
  const body = init.body;

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return;
  }
  assertWellFormedJsonStrings(payload, 'request');
}

/**
 * Rejects lone UTF-16 surrogate code units in the JSON material that feeds the
 * current Travelport Stays SearchComplete -> Rules -> Availability reservation
 * authority chain. The guard is deliberately provider-specific and preserves
 * every well-formed non-BMP character allowed by the existing field contracts.
 */
export function createTravelportStaysPreWriteUnicodeAuthorityFetch(
  fetchImpl: typeof fetch = fetch,
): typeof fetch {
  return (async (input, init) => {
    const url = requestUrl(input);
    if (!targetsPreWriteStaysJson(url)) return fetchImpl(input, init);

    inspectRequestBodyIfMaterialized(init);
    const response = await fetchImpl(input, init);
    if (!response.ok) return response;

    const payload = await response.clone().json().catch(() => null);
    if (payload !== null) assertWellFormedJsonStrings(payload, 'response');
    return response;
  }) as typeof fetch;
}
