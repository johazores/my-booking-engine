/**
 * Browser Origin is a serialized origin, not an arbitrary URL. Compare it
 * exactly to the HTTP(S) request origin instead of normalizing attacker input.
 * This is not a substitute for trusted proxy Host validation.
 */
export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;

  try {
    const target = new URL(request.url);
    return (target.protocol === 'https:' || target.protocol === 'http:') && origin === target.origin;
  } catch {
    return false;
  }
}
