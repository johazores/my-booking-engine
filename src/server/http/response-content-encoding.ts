/**
 * Interpret HTTP Content-Encoding without treating an empty, malformed, or
 * explicit identity value as proof that Fetch decompressed a response.
 *
 * Unknown valid coding tokens remain encoded: provider transports must not
 * assume which compression algorithms the Fetch implementation supports.
 */
const CONTENT_CODING_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

export type HttpResponseContentEncoding = 'identity' | 'encoded' | 'invalid';

export function classifyHttpResponseContentEncoding(headers: Headers): HttpResponseContentEncoding {
  const raw = headers.get('content-encoding');
  if (raw === null) return 'identity';
  if (raw.length === 0 || raw.length > 512) return 'invalid';

  const codings = raw.split(',');
  if (codings.length > 16) return 'invalid';

  let encoded = false;
  for (const coding of codings) {
    // HTTP OWS permits only SP and HTAB, not Unicode whitespace or controls.
    const token = coding.replace(/^[ \t]+|[ \t]+$/g, '');
    if (!CONTENT_CODING_TOKEN.test(token)) return 'invalid';
    if (token.toLowerCase() !== 'identity') encoded = true;
  }
  return encoded ? 'encoded' : 'identity';
}

/**
 * SF never requests byte ranges from payment or supplier providers. Reject
 * partial success and ambiguous wire framing before parsing commercial data.
 * Error responses may legitimately include Content-Range (for example 416).
 */
export function hasUnsafeProviderResponseFraming(headers: Headers, status: number): boolean {
  return (headers.has('content-length') && headers.has('transfer-encoding'))
    || (status >= 200 && status < 300 && (status === 206 || headers.has('content-range')));
}
