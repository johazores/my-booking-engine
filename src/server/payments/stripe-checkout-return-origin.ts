const MAX_CHECKOUT_RETURN_ORIGIN_CHARS = 2_048;
const UNSAFE_ORIGIN_TEXT = /[\u0000-\u001f\u007f-\u009f]/;

export class StripeCheckoutReturnOriginConfigurationError extends Error {
  constructor() {
    super('Stripe Checkout requires a canonical configured public application origin.');
    this.name = 'StripeCheckoutReturnOriginConfigurationError';
  }
}

/**
 * Checkout return navigation must come from deployment configuration, never
 * the request URL/Host header. Tenant custom domains are configuration-only
 * until domain ownership and routing have been verified.
 */
export function resolveStripeCheckoutReturnOrigin(configuredUrl: unknown, production: boolean): string {
  const invalid = () => new StripeCheckoutReturnOriginConfigurationError();
  if (
    typeof configuredUrl !== 'string'
    || configuredUrl.length === 0
    || configuredUrl.length > MAX_CHECKOUT_RETURN_ORIGIN_CHARS
    || !configuredUrl.isWellFormed()
    || UNSAFE_ORIGIN_TEXT.test(configuredUrl)
    || configuredUrl !== configuredUrl.trim()
  ) throw invalid();

  let url: URL;
  try {
    url = new URL(configuredUrl);
  } catch {
    throw invalid();
  }

  // Only an exact canonical origin (with optional trailing slash) is allowed.
  // Reject parser-repaired hostnames, default ports, path/query/fragment aliases,
  // userinfo, and raw URL text that would navigate differently after parsing.
  if (
    url.username || url.password || url.search || url.hash
    || configuredUrl.includes('?') || configuredUrl.includes('#')
    || url.pathname !== '/'
    || (configuredUrl !== url.origin && configuredUrl !== url.href)
    || url.hostname.endsWith('.')
  ) throw invalid();

  const localHostname = url.hostname === 'localhost'
    || url.hostname.endsWith('.localhost')
    || url.hostname === '127.0.0.1'
    || url.hostname === '[::1]';
  if (production) {
    if (url.protocol !== 'https:' || localHostname) throw invalid();
  } else if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localHostname)) {
    throw invalid();
  }
  return url.origin;
}
