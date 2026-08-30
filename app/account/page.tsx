import Link from 'next/link';
import { redirect } from 'next/navigation';

import { BrandMark } from '@/components/brand-mark';
import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { listOrganizationsForUser } from '@/server/organizations/organization-repository.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

const organizationErrors: Record<string, string> = {
  validation: 'Check the organization details and try again.',
  slug: 'That organization URL slug is already in use.',
  selection: 'Choose a valid organization.',
  server: 'The organization could not be created. Try again.',
};

const statusMessages: Record<string, string> = {
  created: 'Your account was created securely.',
  'signed-in': 'Signed in successfully.',
  'organization-created': 'Organization created and selected.',
  'organization-selected': 'Active organization updated.',
};

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ status?: string; organizationError?: string }> }) {
  const authState = await readAuthSessionState();
  const authRedirect = getAuthRequiredRedirect(authState);
  if (authRedirect) redirect(authRedirect);

  const session = authState.session;
  if (!session) throw new Error('Authenticated account guard returned without a session');

  const params = await searchParams;
  const organizations = await listOrganizationsForUser(session.user.id);
  const activeContext = await readActiveOrganizationContext(session.user.id);
  const statusMessage = params.status ? statusMessages[params.status] : undefined;
  const organizationError = params.organizationError ? organizationErrors[params.organizationError] : undefined;

  return (
    <main className="sf-account-shell">
      <header className="sf-account-header">
        <BrandMark />
        <form action="/api/auth/sign-out" method="post">
          <button className="sf-button sf-button--secondary" type="submit">Sign out</button>
        </form>
      </header>

      <section className="sf-account-panel" aria-labelledby="account-title">
        {statusMessage ? <p className="sf-alert sf-alert--success" role="status">{statusMessage}</p> : null}
        {organizationError ? <p className="sf-alert sf-alert--error" role="alert">{organizationError}</p> : null}
        {activeContext.hadOrganizationCookie && !activeContext.organization ? <p className="sf-alert sf-alert--error" role="alert">Your previous organization selection is no longer available. Choose another active organization.</p> : null}
        <p className="sf-eyebrow">Authenticated account</p>
        <h1 className="sf-account-panel__title" id="account-title">{session.user.displayName || session.user.email}</h1>
        <dl className="sf-account-details">
          <div><dt>Email</dt><dd>{session.user.email}</dd></div>
          <div><dt>Session expires</dt><dd>{session.expiresAt.toLocaleString()}</dd></div>
          <div><dt>Active organization</dt><dd>{activeContext.organization?.name ?? 'Not selected'}</dd></div>
        </dl>
      </section>

      <section className="sf-account-panel" aria-labelledby="organizations-title">
        <div className="sf-account-panel__heading">
          <div><p className="sf-eyebrow">Tenant access</p><h2 id="organizations-title">Your organizations</h2></div>
          <Link href="/" className="sf-header__link">Back to SF</Link>
        </div>
        {organizations.length === 0 ? (
          <div className="sf-empty-state"><h3>No organizations yet</h3><p>Create your first organization below. Authentication alone never grants access to another tenant.</p></div>
        ) : (
          <ul className="sf-organization-list">
            {organizations.map((organization) => {
              const isActive = activeContext.organization?.id === organization.id;
              return (
                <li key={organization.id}>
                  <div><strong>{organization.name}</strong><span>{organization.slug}</span></div>
                  {isActive ? <span className="sf-status-badge">Active</span> : (
                    <form action="/api/organizations/select" method="post">
                      <input type="hidden" name="organizationId" value={organization.id} />
                      <button className="sf-button sf-button--secondary sf-button--compact" type="submit">Use organization</button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="sf-account-panel" aria-labelledby="create-organization-title">
        <p className="sf-eyebrow">Organization onboarding</p>
        <h2 id="create-organization-title">Create an organization</h2>
        <p className="sf-auth-card__copy">The creator receives an active membership. Management permissions are introduced separately in the authorization phase.</p>
        <form className="sf-form sf-organization-form" action="/api/organizations" method="post">
          <label className="sf-field">Business name<input name="name" minLength={2} maxLength={160} required autoComplete="organization" /></label>
          <label className="sf-field">URL slug<input name="slug" minLength={3} maxLength={63} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="optional-auto-from-name" /><small>Optional. Lowercase letters, numbers, and single hyphens.</small></label>
          <label className="sf-field">Business type<select name="kind" defaultValue="OTHER" required><option value="HOTEL">Hotel</option><option value="RESORT">Resort</option><option value="TRAVEL_AGENCY">Travel agency</option><option value="TOUR_OPERATOR">Tour operator</option><option value="APPOINTMENT_BUSINESS">Appointment business</option><option value="RENTAL_BUSINESS">Rental business</option><option value="MARKETPLACE">Marketplace</option><option value="OTHER">Other</option></select></label>
          <div className="sf-form-row">
            <label className="sf-field">Timezone<input name="timezone" defaultValue="UTC" maxLength={80} required /></label>
            <label className="sf-field">Currency<input name="currency" defaultValue="USD" minLength={3} maxLength={3} pattern="[A-Za-z]{3}" required /></label>
          </div>
          <button className="sf-button sf-button--primary" type="submit">Create organization</button>
        </form>
      </section>
    </main>
  );
}
