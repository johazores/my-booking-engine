import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';

import { ACTIVE_ORGANIZATION_COOKIE, activeOrganizationCookieOptions } from '../tenancy/tenant-context.ts';

import { resolveAuthSession } from './auth-service.ts';
export {
  AUTH_FORM_MAX_BYTES,
  applyAuthResponseNoStore,
  getAuthRequiredRedirect,
  isSameOriginAuthRequest,
  isSupportedAuthFormRequest,
} from './auth-http-policy.ts';

/** An organization selection belongs to the previous browser identity, not the new session. */
export function clearSelectedOrganizationCookie(response: NextResponse) {
  response.cookies.set(ACTIVE_ORGANIZATION_COOKIE, '', {
    ...activeOrganizationCookieOptions,
    expires: new Date(0),
    maxAge: 0,
  });
}

export const AUTH_SESSION_COOKIE = 'sf_session';

export const authSessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};

export async function readAuthSessionState() {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_SESSION_COOKIE)?.value;

  if (!token) {
    return { hadSessionCookie: false, session: null } as const;
  }

  return {
    hadSessionCookie: true,
    session: await resolveAuthSession(token),
  } as const;
}

export async function readAuthSession() {
  return (await readAuthSessionState()).session;
}
