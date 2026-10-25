/** Snapshot a bounded five-field OAuth grant from native URLSearchParams state. */
const FIELD_LIMITS: Readonly<Record<string, number>> = Object.freeze({
  username: 512, password: 4096, client_id: 512, client_secret: 4096,
});
export type TravelportStaysOAuthBodySnapshot = Readonly<{
  body: URLSearchParams;
  credentials: Readonly<{ username: string; password: string; client_id: string; client_secret: string }>;
}>;

/** Reject overridden iterators/getters, extra fields, and mutable caller-owned form authority. */
export function materializeTravelportStaysOAuthRequestBody(
  body: BodyInit | null,
): TravelportStaysOAuthBodySnapshot | null {
  try {
    if (!(body instanceof URLSearchParams)) return null;
    const iterator = URLSearchParams.prototype.entries.call(body);
    const values = new Map<string, string>();
    for (let index = 0; index < 6; index += 1) {
      const entry = iterator.next();
      if (entry.done) break;
      if (index === 5) return null;
      const [name, value] = entry.value;
      if (values.has(name)) return null;
      if (name === 'grant_type') {
        if (value !== 'password') return null;
      } else {
        const limit = Object.hasOwn(FIELD_LIMITS, name) ? FIELD_LIMITS[name] : undefined;
        if (
          limit === undefined || value.length === 0 || value.length > limit
          || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)
        ) return null;
      }
      values.set(name, value);
    }
    if (
      values.size !== 5 || values.get('grant_type') !== 'password'
      || !values.has('username') || !values.has('password')
      || !values.has('client_id') || !values.has('client_secret')
    ) return null;
    const credentials = Object.freeze({
      username: values.get('username')!,
      password: values.get('password')!,
      client_id: values.get('client_id')!,
      client_secret: values.get('client_secret')!,
    });
    return Object.freeze({
      credentials,
      body: new URLSearchParams([
        ['grant_type', 'password'], ['username', credentials.username],
        ['password', credentials.password], ['client_id', credentials.client_id],
        ['client_secret', credentials.client_secret],
      ]),
    });
  } catch {
    // Do not disclose error messages from hostile/proxied credential sources.
    return null;
  }
}
