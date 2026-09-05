import { NextResponse } from 'next/server';

import { AuthValidationError } from '@/server/auth/auth-domain.ts';
import {
  AUTH_SESSION_COOKIE,
  authSessionCookieOptions,
  isSameOriginAuthRequest,
  isSupportedAuthFormRequest,
} from '@/server/auth/auth-http.ts';
import {
  InvalidCredentialsError,
  signInWithPassword,
} from '@/server/auth/auth-service.ts';
import { createRequestObservation, type RequestLogFailureOutcome } from '@/server/observability/request-observability.ts';

function field(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

export async function POST(request: Request) {
  const observation = createRequestObservation(request, { operation: 'auth.sign-in' });
  const finish = (response: Response, failureOutcome?: RequestLogFailureOutcome) => observation.finish(
    response,
    undefined,
    failureOutcome ? { failureOutcome } : undefined,
  );

  if (!isSameOriginAuthRequest(request)) {
    return finish(new Response('Forbidden', { status: 403 }));
  }

  if (!isSupportedAuthFormRequest(request)) {
    return finish(new Response('Unsupported Media Type', { status: 415 }));
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return finish(NextResponse.redirect(new URL('/sign-in?error=validation', request.url), 303), 'rejected');
  }

  try {
    const result = await signInWithPassword({
      email: field(formData, 'email'),
      password: field(formData, 'password'),
    });
    const response = NextResponse.redirect(new URL('/account?status=signed-in', request.url), 303);
    response.cookies.set(AUTH_SESSION_COOKIE, result.token, {
      ...authSessionCookieOptions,
      expires: result.expiresAt,
    });
    return finish(response);
  } catch (error) {
    const code =
      error instanceof InvalidCredentialsError
        ? 'credentials'
        : error instanceof AuthValidationError
          ? 'validation'
          : 'server';
    return finish(
      NextResponse.redirect(new URL(`/sign-in?error=${code}`, request.url), 303),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
