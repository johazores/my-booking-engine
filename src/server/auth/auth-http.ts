import { cookies } from 'next/headers';

import { resolveAuthSession } from './auth-service.ts';

export const AUTH_SESSION_COOKIE = 'sf_session';

export const authSessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};

export function isSameOriginAuthRequest(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) {
    return false;
  }

  return origin === new URL(request.url).origin;
}

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
