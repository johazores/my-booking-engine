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

export function getAuthRequiredRedirect(state: AuthSessionStateLike) {
  if (state.session) {
    return null;
  }

  return state.hadSessionCookie
    ? '/sign-in?error=session'
    : '/sign-in?error=required';
}
