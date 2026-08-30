import Link from 'next/link';
import { redirect } from 'next/navigation';

import { BrandMark } from '@/components/brand-mark';
import { listOrganizationsForUser } from '@/server/organizations/organization-repository.ts';
import { readAuthSessionState } from '@/server/auth/auth-http.ts';

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { hadSessionCookie, session } = await readAuthSessionState();
  if (!session) {
    redirect(hadSessionCookie ? '/sign-in?error=session' : '/sign-in?error=required');
  }

  const params = await searchParams;
  const organizations = await listOrganizationsForUser(session.user.id);

  return (
    <main className="sf-account-shell">
      <header className="sf-account-header">
        <BrandMark />
        <form action="/api/auth/sign-out" method="post">
          <button className="sf-button sf-button--secondary" type="submit">Sign out</button>
        </form>
      </header>

      <section className="sf-account-panel" aria-labelledby="account-title">
        {params.status === 'created' ? <p className="sf-alert sf-alert--success">Your account was created securely.</p> : null}
        {params.status === 'signed-in' ? <p className="sf-alert sf-alert--success">Signed in successfully.</p> : null}
        <p className="sf-eyebrow">Authenticated account</p>
        <h1 className="sf-account-panel__title" id="account-title">{session.user.displayName || session.user.email}</h1>
        <dl className="sf-account-details">
          <div><dt>Email</dt><dd>{session.user.email}</dd></div>
          <div><dt>Session expires</dt><dd>{session.expiresAt.toLocaleString()}</dd></div>
        </dl>
      </section>

      <section className="sf-account-panel" aria-labelledby="organizations-title">
        <div className="sf-account-panel__heading">
          <div>
            <p className="sf-eyebrow">Tenant access</p>
            <h2 id="organizations-title">Your organizations</h2>
          </div>
          <Link href="/" className="sf-header__link">Back to SF</Link>
        </div>
        {organizations.length === 0 ? (
          <div className="sf-empty-state">
            <h3>No active organization memberships</h3>
            <p>Your identity is active, but no tenant access has been granted yet. Organization onboarding is implemented separately so authentication never implies tenant authorization.</p>
          </div>
        ) : (
          <ul className="sf-organization-list">
            {organizations.map((organization) => (
              <li key={organization.id}>
                <strong>{organization.name}</strong>
                <span>{organization.slug}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
