import { NextResponse } from 'next/server';
import { readBoundedFormDataOrThrow } from '@/server/http/bounded-form-body.ts';

import { reserveAuthAttempt } from '@/server/auth/auth-abuse-repository.ts';
import { AuthValidationError, createCanonicalAuthEmail } from '@/server/auth/auth-domain.ts';
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
    formData = await readBoundedFormDataOrThrow(request);
  } catch {
    return finish(NextResponse.redirect(new URL('/sign-in?error=validation', request.url), 303), 'rejected');
  }

  try {
    // Reject malformed identities before they consume shared deployment capacity.
    const email = createCanonicalAuthEmail(field(formData, 'email'));
    const attempt = await reserveAuthAttempt('sign-in', email);
    if (!attempt.allowed) {
      const response = NextResponse.redirect(new URL('/sign-in?error=rate-limited', request.url), 303);
      response.headers.set('Retry-After', String(attempt.retryAfterSeconds));
      return finish(response, 'rejected');
    }

    const result = await signInWithPassword({
      email,
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
