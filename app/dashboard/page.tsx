import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { organizationRoleHasPermission } from '@/server/authorization/authorization-domain.ts';
import { readOrganizationAuthorization } from '@/server/authorization/authorization-service.ts';
import { listMembershipsForOrganization } from '@/server/memberships/membership-repository.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

export default async function DashboardPage() {
  const authState = await readAuthSessionState();
  const authRedirect = getAuthRequiredRedirect(authState);
  if (authRedirect) redirect(authRedirect);

  const session = authState.session;
  if (!session) throw new Error('Authenticated dashboard guard returned without a session');

  const activeContext = await readActiveOrganizationContext(session.user.id);

  if (!activeContext.organization) {
    return (
      <section className="sf-dashboard-empty" aria-labelledby="dashboard-empty-title">
        <p className="sf-eyebrow">Workspace setup</p>
        <h1 id="dashboard-empty-title">Choose an organization to start working</h1>
        <p>Your dashboard only exposes tenant data after SF revalidates your active organization membership on the server.</p>
        <Link className="sf-button sf-button--primary" href="/account">Choose or create organization</Link>
      </section>
    );
  }

  const organization = activeContext.organization;
  const authorization = await readOrganizationAuthorization({ organizationId: organization.id, userId: session.user.id });
  const canReadMembers = Boolean(
    authorization.platformAdmin ||
    (authorization.role && organizationRoleHasPermission(authorization.role, 'membership:read')),
  );
  const memberships = canReadMembers
    ? await listMembershipsForOrganization({ organizationId: organization.id, userId: session.user.id })
    : [];
  const activeMembers = memberships.filter((membership) => membership.status === 'ACTIVE').length;

  return (
    <div className="sf-dashboard">
      <header className="sf-dashboard-hero">
        <div>
          <p className="sf-eyebrow">Operational workspace</p>
          <h1>{organization.name}</h1>
          <p>Real tenant configuration and access state for the currently selected organization.</p>
        </div>
        <Link className="sf-button sf-button--secondary" href="/account">Manage organization</Link>
      </header>

      <section className="sf-dashboard-grid" aria-label="Organization overview">
        <article className="sf-dashboard-card">
          <span className="sf-dashboard-card__label">Organization</span>
          <strong>{organization.kind.toLowerCase().replaceAll('_', ' ')}</strong>
          <span>{organization.slug}</span>
        </article>
        <article className="sf-dashboard-card">
          <span className="sf-dashboard-card__label">Localization</span>
          <strong>{organization.currency}</strong>
          <span>{organization.timezone}</span>
        </article>
        <article className="sf-dashboard-card">
          <span className="sf-dashboard-card__label">Your access</span>
          <strong>{authorization.platformAdmin ? 'platform admin' : authorization.role?.toLowerCase() ?? 'member'}</strong>
          <span>Validated server-side</span>
        </article>
        <article className="sf-dashboard-card">
          <span className="sf-dashboard-card__label">Team access</span>
          <strong>{canReadMembers ? activeMembers : 'Restricted'}</strong>
          <span>{canReadMembers ? `${memberships.length} membership records` : 'Your role cannot read memberships'}</span>
        </article>
      </section>

      <section className="sf-dashboard-section" aria-labelledby="foundation-status-title">
        <div className="sf-dashboard-section__heading">
          <div>
            <p className="sf-eyebrow">Current production foundation</p>
            <h2 id="foundation-status-title">What this workspace is using now</h2>
          </div>
        </div>
        <ul className="sf-dashboard-status-list">
          <li><strong>Authenticated session</strong><span>{session.user.email}</span></li>
          <li><strong>Tenant context</strong><span>{organization.name} is revalidated against active membership on the server.</span></li>
          <li><strong>Authorization</strong><span>{authorization.platformAdmin ? 'Platform administration' : authorization.role ? `${authorization.role.toLowerCase()} organization role` : 'No organization role'}.</span></li>
          <li><strong>Organization lifecycle</strong><span>Settings, membership changes, and archival remain permission checked and audited.</span></li>
        </ul>
      </section>
    </div>
  );
}
