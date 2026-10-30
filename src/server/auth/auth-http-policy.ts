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
