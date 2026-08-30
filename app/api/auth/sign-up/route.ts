import { NextResponse } from 'next/server';

import { AuthValidationError } from '@/server/auth/auth-domain.ts';
import { AUTH_SESSION_COOKIE, authSessionCookieOptions } from '@/server/auth/auth-http.ts';
import {
  AuthConflictError,
  registerWithPassword,
} from '@/server/auth/auth-service.ts';

function field(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

export async function POST(request: Request) {
  const formData = await request.formData();

  try {
    const result = await registerWithPassword({
      email: field(formData, 'email'),
      password: field(formData, 'password'),
      displayName: field(formData, 'displayName') || undefined,
    });
    const response = NextResponse.redirect(new URL('/account?status=created', request.url), 303);
    response.cookies.set(AUTH_SESSION_COOKIE, result.token, {
      ...authSessionCookieOptions,
      expires: result.expiresAt,
    });
    return response;
  } catch (error) {
    const code =
      error instanceof AuthConflictError
        ? 'exists'
        : error instanceof AuthValidationError
          ? 'validation'
          : 'server';
    return NextResponse.redirect(new URL(`/sign-up?error=${code}`, request.url), 303);
  }
}
