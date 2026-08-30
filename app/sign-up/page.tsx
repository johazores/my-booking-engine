import Link from 'next/link';
import { redirect } from 'next/navigation';

import { BrandMark } from '@/components/brand-mark';
import { readAuthSession } from '@/server/auth/auth-http.ts';

const messages: Record<string, string> = {
  exists: 'An account with this email already exists.',
  validation: 'Check your details. Passwords must contain 12 to 128 characters.',
  server: 'Your account could not be created. Please try again.',
};

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await readAuthSession();
  if (session) {
    redirect('/account');
  }

  const params = await searchParams;
  const message = params.error ? messages[params.error] : undefined;

  return (
    <main className="sf-auth-shell">
      <section className="sf-auth-card" aria-labelledby="sign-up-title">
        <BrandMark />
        <div>
          <p className="sf-eyebrow">Create your SF identity</p>
          <h1 className="sf-auth-card__title" id="sign-up-title">Create an account</h1>
          <p className="sf-auth-card__copy">Your account is separate from organization access. Tenant permissions are granted through current memberships.</p>
        </div>
        {message ? <p className="sf-alert sf-alert--error" role="alert">{message}</p> : null}
        <form className="sf-form" action="/api/auth/sign-up" method="post">
          <label className="sf-field">
            <span>Name <small>(optional)</small></span>
            <input name="displayName" type="text" autoComplete="name" maxLength={160} />
          </label>
          <label className="sf-field">
            <span>Email</span>
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <label className="sf-field">
            <span>Password</span>
            <input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required aria-describedby="password-help" />
            <small id="password-help">Use 12 to 128 characters. Passwords are not trimmed or normalized.</small>
          </label>
          <button className="sf-button sf-button--primary" type="submit">Create account</button>
        </form>
        <p className="sf-auth-card__foot">Already have an account? <Link href="/sign-in">Sign in</Link></p>
      </section>
    </main>
  );
}
