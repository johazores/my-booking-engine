import { readBoundedFormDataOrThrow } from '@/server/http/bounded-form-body.ts';

import { reserveAuthAttempt } from '@/server/auth/auth-abuse-repository.ts';
import { AuthValidationError, validateSignInInput } from '@/server/auth/auth-domain.ts';
import {
  AUTH_FORM_MAX_BYTES,
  AUTH_SESSION_COOKIE,
  applyAuthResponseNoStore,
  clearSelectedOrganizationCookie,
  authSessionCookieOptions,
  isSameOriginAuthRequest,
  isSupportedAuthFormRequest,
  redirectToLocalPath,
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
  const finish = (response: Response, failureOutcome?: RequestLogFailureOutcome, authRateLimited?: true) => observation.finish(
    applyAuthResponseNoStore(response),
    undefined,
    failureOutcome ? { failureOutcome, ...(authRateLimited ? { authRateLimited } : {}) } : undefined,
  );

  if (!isSameOriginAuthRequest(request)) {
    return finish(new Response('Forbidden', { status: 403 }));
  }

  if (!isSupportedAuthFormRequest(request)) {
    return finish(new Response('Unsupported Media Type', { status: 415 }));
  }

  let formData: FormData;
  try {
    formData = await readBoundedFormDataOrThrow(request, AUTH_FORM_MAX_BYTES);
  } catch {
    return finish(redirectToLocalPath('/sign-in?error=validation'), 'rejected');
  }

  try {
    // Malformed credentials must not spend per-identity or deployment-wide capacity.
    const credentials = validateSignInInput({
      email: field(formData, 'email'),
      password: field(formData, 'password'),
    });
    const attempt = await reserveAuthAttempt('sign-in', credentials.email, request.signal);
    if (!attempt.allowed) {
      const response = redirectToLocalPath(`/sign-in?error=rate-limited&retry=${attempt.retryAfterSeconds}`);
      response.headers.set('Retry-After', String(attempt.retryAfterSeconds));
      return finish(response, 'rejected', true);
    }

    const result = await signInWithPassword(credentials, request.signal);
    const response = redirectToLocalPath('/account?status=signed-in');
    response.cookies.set(AUTH_SESSION_COOKIE, result.token, {
      ...authSessionCookieOptions,
      expires: result.expiresAt,
    });
    clearSelectedOrganizationCookie(response);
    return finish(response);
  } catch (error) {
    const code =
      error instanceof InvalidCredentialsError
        ? 'credentials'
        : error instanceof AuthValidationError
          ? 'validation'
          : 'server';
    return finish(
      redirectToLocalPath(`/sign-in?error=${code}`),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
