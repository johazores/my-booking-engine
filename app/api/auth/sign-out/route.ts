import { NextRequest } from 'next/server';

import {
  AUTH_SESSION_COOKIE,
  applyAuthResponseNoStore,
  clearSelectedOrganizationCookie,
  authSessionCookieOptions,
  isSameOriginAuthRequest,
  redirectToLocalPath,
} from '@/server/auth/auth-http.ts';
import { signOutSession } from '@/server/auth/auth-service.ts';
import { createRequestObservation } from '@/server/observability/request-observability.ts';

export async function POST(request: NextRequest) {
  const observation = createRequestObservation(request, { operation: 'auth.sign-out' });
  const finish = (response: Response) => observation.finish(applyAuthResponseNoStore(response));

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

  const response = redirectToLocalPath('/sign-in?status=signed-out');
  response.cookies.set(AUTH_SESSION_COOKIE, '', {
    ...authSessionCookieOptions,
    expires: new Date(0),
    maxAge: 0,
  });
  clearSelectedOrganizationCookie(response);
  return finish(response);
}
