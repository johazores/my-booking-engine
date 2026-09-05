import { NextRequest, NextResponse } from 'next/server';

import {
  AUTH_SESSION_COOKIE,
  authSessionCookieOptions,
  isSameOriginAuthRequest,
} from '@/server/auth/auth-http.ts';
import { signOutSession } from '@/server/auth/auth-service.ts';
import { createRequestObservation } from '@/server/observability/request-observability.ts';

export async function POST(request: NextRequest) {
  const observation = createRequestObservation(request, { operation: 'auth.sign-out' });
  const finish = (response: Response) => observation.finish(response);

  if (!isSameOriginAuthRequest(request)) {
    return finish(new Response('Forbidden', { status: 403 }));
  }

  const token = request.cookies.get(AUTH_SESSION_COOKIE)?.value;
  try {
    if (token) {
      await signOutSession(token);
    }
  } catch {
    return finish(new Response('Unable to sign out', { status: 500 }));
  }

  const response = NextResponse.redirect(new URL('/sign-in?status=signed-out', request.url), 303);
  response.cookies.set(AUTH_SESSION_COOKIE, '', {
    ...authSessionCookieOptions,
    expires: new Date(0),
    maxAge: 0,
  });
  return finish(response);
}
