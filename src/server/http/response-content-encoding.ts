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
    const token = coding.trim();
    if (!CONTENT_CODING_TOKEN.test(token)) return 'invalid';
    if (token.toLowerCase() !== 'identity') encoded = true;
  }
  return encoded ? 'encoded' : 'identity';
}
