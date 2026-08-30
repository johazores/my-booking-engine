import { NextRequest, NextResponse } from 'next/server';

import {
  AUTH_SESSION_COOKIE,
  authSessionCookieOptions,
  isSameOriginAuthRequest,
} from '@/server/auth/auth-http.ts';
import { signOutSession } from '@/server/auth/auth-service.ts';

export async function POST(request: NextRequest) {
  if (!isSameOriginAuthRequest(request)) {
    return new Response('Forbidden', { status: 403 });
  }

  const token = request.cookies.get(AUTH_SESSION_COOKIE)?.value;
  if (token) {
    await signOutSession(token);
  }

  const response = NextResponse.redirect(new URL('/sign-in?status=signed-out', request.url), 303);
  response.cookies.set(AUTH_SESSION_COOKIE, '', {
    ...authSessionCookieOptions,
    expires: new Date(0),
    maxAge: 0,
  });
  return response;
}
