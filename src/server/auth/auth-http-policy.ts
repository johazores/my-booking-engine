import { AUTH_ATTEMPT_WINDOW_SECONDS } from './auth-abuse-domain.ts';

/** Credential forms need far less than the general 64 KiB mutation limit. */
export const AUTH_FORM_MAX_BYTES = 8 * 1024;

export type AuthSessionStateLike = {
  hadSessionCookie: boolean;
  session: unknown | null;
};

const AUTH_FORM_MEDIA_TYPES = new Set([
  'application/x-www-form-urlencoded',
  'multipart/form-data',
]);

export function isSameOriginAuthRequest(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) {
    return false;
  }

  return origin === new URL(request.url).origin;
}

export function isSupportedAuthFormRequest(request: Request) {
  const contentType = request.headers.get('content-type');
  if (!contentType) {
    return false;
  }

  const mediaType = contentType.split(';', 1)[0]?.trim().toLowerCase();
  return mediaType ? AUTH_FORM_MEDIA_TYPES.has(mediaType) : false;
}

/** Prevent credential and sign-out responses from being stored by caches. */
export function applyAuthResponseNoStore<T extends Response>(response: T): T {
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export function getAuthRequiredRedirect(state: AuthSessionStateLike) {
  if (state.session) {
    return null;
  }

  return state.hadSessionCookie
    ? '/sign-in?error=session'
    : '/sign-in?error=required';
}

/** Browser mutation redirects must not inherit an untrusted request Host. */
export function getLocalPostRedirectLocation(path: string) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') ||
      /[\\\u0000-\u001f\u007f]/.test(path)) {
    throw new TypeError('Browser mutation redirects require a local absolute path.');
  }
  return path;
}

/** Browser redirects lose Retry-After headers; this value is informational only. */
export function getAuthRateLimitMessage(retryAfter: unknown) {
  const generic = 'Too many attempts. Please wait before trying again.';
  if (typeof retryAfter !== 'string' || !/^[1-9][0-9]{0,2}$/.test(retryAfter)) return generic;
  const seconds = Number(retryAfter);
  if (seconds > AUTH_ATTEMPT_WINDOW_SECONDS) return generic;
  const minutes = Math.ceil(seconds / 60);
  return `Too many attempts. Please wait about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} before trying again.`;
}
