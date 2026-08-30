import Link from 'next/link';

import { BrandMark } from '@/components/brand-mark';

const messages: Record<string, string> = {
  required: 'Sign in to continue.',
  credentials: 'The email or password is incorrect.',
  validation: 'Enter a valid email address and password.',
  server: 'Sign in could not be completed. Please try again.',
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string; status?: string }> }) {
  const params = await searchParams;
  const message = params.error ? messages[params.error] : undefined;

  return (
    <main className="sf-auth-shell">
      <section className="sf-auth-card" aria-labelledby="sign-in-title">
        <BrandMark />
        <div>
          <p className="sf-eyebrow">Secure account access</p>
          <h1 className="sf-auth-card__title" id="sign-in-title">Sign in to SF</h1>
          <p className="sf-auth-card__copy">Use your account to access organizations you currently belong to.</p>
        </div>
        {params.status === 'signed-out' ? <p className="sf-alert sf-alert--success">You have been signed out.</p> : null}
        {message ? <p className="sf-alert sf-alert--error" role="alert">{message}</p> : null}
        <form className="sf-form" action="/api/auth/sign-in" method="post">
          <label className="sf-field"><span>Email</span><input name="email" type="email" autoComplete="email" required /></label>
          <label className="sf-field"><span>Password</span><input name="password" type="password" autoComplete="current-password" minLength={12} maxLength={128} required /></label>
          <button className="sf-button sf-button--primary" type="submit">Sign in</button>
        </form>
        <p className="sf-auth-card__foot">New to SF? <Link href="/sign-up">Create an account</Link></p>
      </section>
    </main>
  );
}
