import Link from 'next/link';
import { redirect } from 'next/navigation';

import { BrandMark } from '@/components/brand-mark';
import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { organizationRoleHasPermission } from '@/server/authorization/authorization-domain.ts';
import { readOrganizationAuthorization } from '@/server/authorization/authorization-service.ts';
import { listMembershipsForOrganization } from '@/server/memberships/membership-repository.ts';
import { listOrganizationsForUser } from '@/server/organizations/organization-repository.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

const organizationErrors: Record<string, string> = {
  validation: 'Check the organization details and try again.',
  slug: 'That organization URL slug is already in use.',
  selection: 'Choose a valid organization.',
  server: 'The organization could not be created. Try again.',
};

const roleErrors: Record<string, string> = {
  tenant: 'Choose an active organization before managing roles.',
  permission: 'You do not have permission to manage organization roles.',
  'last-admin': 'An organization must keep at least one active administrator.',
  validation: 'Choose a valid member and role.',
  server: 'The role could not be updated. Try again.',
};

const memberErrors: Record<string, string> = {
  tenant: 'Choose an active organization before managing members.',
  permission: 'You do not have permission to manage organization members.',
  'last-admin': 'An organization must keep at least one active administrator.',
  validation: 'Choose a valid membership status change.',
  server: 'The membership could not be updated. Try again.',
};

const statusMessages: Record<string, string> = {
  created: 'Your account was created securely.',
  'signed-in': 'Signed in successfully.',
  'organization-created': 'Organization created and selected.',
  'organization-selected': 'Active organization updated.',
  'role-updated': 'Member role updated and audited.',
  'membership-updated': 'Membership status updated and audited.',
};

function membershipStatusOptions(status: string) {
  if (status === 'INVITED') return [{ value: 'ACTIVE', label: 'Activate' }, { value: 'ARCHIVED', label: 'Archive' }];
  if (status === 'ACTIVE') return [{ value: 'SUSPENDED', label: 'Suspend' }, { value: 'ARCHIVED', label: 'Archive' }];
  if (status === 'SUSPENDED') return [{ value: 'ACTIVE', label: 'Reactivate' }, { value: 'ARCHIVED', label: 'Archive' }];
  return [];
}

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ status?: string; organizationError?: string; roleError?: string; memberError?: string }> }) {
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
  const roleError = params.roleError ? roleErrors[params.roleError] : undefined;
  const memberError = params.memberError ? memberErrors[params.memberError] : undefined;

  const authorization = activeContext.organization
    ? await readOrganizationAuthorization({ organizationId: activeContext.organization.id, userId: session.user.id })
    : null;
  const canReadMembers = Boolean(authorization?.platformAdmin || (authorization?.role && organizationRoleHasPermission(authorization.role, 'membership:read')));
  const canManageMembers = Boolean(authorization?.platformAdmin || (authorization?.role && organizationRoleHasPermission(authorization.role, 'membership:manage')));
  const canManageRoles = Boolean(authorization?.platformAdmin || (authorization?.role && organizationRoleHasPermission(authorization.role, 'membership-role:manage')));
  const memberships = activeContext.organization && canReadMembers
    ? await listMembershipsForOrganization({ organizationId: activeContext.organization.id, userId: session.user.id })
    : [];

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
        {roleError ? <p className="sf-alert sf-alert--error" role="alert">{roleError}</p> : null}
        {memberError ? <p className="sf-alert sf-alert--error" role="alert">{memberError}</p> : null}
        {activeContext.hadOrganizationCookie && !activeContext.organization ? <p className="sf-alert sf-alert--error" role="alert">Your previous organization selection is no longer available. Choose another active organization.</p> : null}
        <p className="sf-eyebrow">Authenticated account</p>
        <h1 className="sf-account-panel__title" id="account-title">{session.user.displayName || session.user.email}</h1>
        <dl className="sf-account-details">
          <div><dt>Email</dt><dd>{session.user.email}</dd></div>
          <div><dt>Session expires</dt><dd>{session.expiresAt.toLocaleString()}</dd></div>
          <div><dt>Active organization</dt><dd>{activeContext.organization?.name ?? 'Not selected'}</dd></div>
          {authorization?.role ? <div><dt>Your role</dt><dd>{authorization.role.toLowerCase()}</dd></div> : null}
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

      {activeContext.organization && canReadMembers ? (
        <section className="sf-account-panel" aria-labelledby="members-title">
          <div className="sf-account-panel__heading"><div><p className="sf-eyebrow">Authorization</p><h2 id="members-title">Organization members</h2></div></div>
          {memberships.length === 0 ? <div className="sf-empty-state"><h3>No members found</h3><p>Active tenant access exists, but no membership records were returned.</p></div> : (
            <ul className="sf-organization-list">
              {memberships.map((membership) => {
                const statusOptions = membershipStatusOptions(membership.status);
                return (
                  <li key={membership.id}>
                    <div><strong>{membership.user.displayName || membership.user.email}</strong><span>{membership.user.email} · {membership.role.toLowerCase()} · {membership.status.toLowerCase()}</span></div>
                    <div className="sf-member-actions">
                      {canManageRoles && membership.status !== 'ARCHIVED' ? (
                        <form action={`/api/organizations/memberships/${membership.id}/role`} method="post" className="sf-inline-form">
                          <label className="sf-visually-hidden" htmlFor={`role-${membership.id}`}>Role for {membership.user.email}</label>
                          <select id={`role-${membership.id}`} name="role" defaultValue={membership.role}>
                            <option value="ADMIN">Admin</option><option value="MANAGER">Manager</option><option value="STAFF">Staff</option><option value="CUSTOMER">Customer</option>
                          </select>
                          <button className="sf-button sf-button--secondary sf-button--compact" type="submit">Update role</button>
                        </form>
                      ) : null}
                      {canManageMembers && statusOptions.length > 0 ? (
                        <form action={`/api/organizations/memberships/${membership.id}/status`} method="post" className="sf-inline-form">
                          <label className="sf-visually-hidden" htmlFor={`status-${membership.id}`}>Status action for {membership.user.email}</label>
                          <select id={`status-${membership.id}`} name="status" defaultValue={statusOptions[0].value}>
                            {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                          </select>
                          <button className="sf-button sf-button--secondary sf-button--compact" type="submit">Update status</button>
                        </form>
                      ) : null}
                      {!canManageRoles && !canManageMembers ? <span className="sf-status-badge">{membership.role.toLowerCase()}</span> : null}
                      {membership.status === 'ARCHIVED' ? <span className="sf-status-badge">Archived</span> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      <section className="sf-account-panel" aria-labelledby="create-organization-title">
        <p className="sf-eyebrow">Organization onboarding</p>
        <h2 id="create-organization-title">Create an organization</h2>
        <p className="sf-auth-card__copy">The creator becomes the first organization administrator. Membership and role changes are permission checked and audited server-side.</p>
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
