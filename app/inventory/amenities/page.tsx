import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { organizationRoleHasPermission } from '@/server/authorization/authorization-domain.ts';
import { readOrganizationAuthorization } from '@/server/authorization/authorization-service.ts';
import { listHospitalityAmenities } from '@/server/inventory/hospitality-amenity-service.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

const errors: Record<string, string> = {
  tenant: 'Choose an active organization before managing amenities.',
  permission: 'You do not have permission to manage amenities.',
  conflict: 'That amenity code is already in use.',
  dependency: 'Remove all property and room-type assignments before archiving this amenity.',
  unavailable: 'That amenity is not available in this organization.',
  validation: 'Check the amenity details and try again.',
  server: 'The amenity operation could not be completed. Try again.',
};

const statuses: Record<string, string> = {
  'amenity-created': 'Amenity created.',
  'amenity-archived': 'Amenity archived.',
};

export default async function AmenitiesPage({ searchParams }: { searchParams: Promise<{ status?: string; error?: string }> }) {
  const authState = await readAuthSessionState();
  const authRedirect = getAuthRequiredRedirect(authState);
  if (authRedirect) redirect(authRedirect);
  const session = authState.session;
  if (!session) throw new Error('Authenticated amenity guard returned without a session');
  const query = await searchParams;
  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) redirect('/inventory?error=tenant');
  const organization = activeContext.organization;
  const authorization = await readOrganizationAuthorization({ organizationId: organization.id, userId: session.user.id });
  const canRead = Boolean(authorization?.platformAdmin || (authorization?.role && organizationRoleHasPermission(authorization.role, 'inventory:read')));
  const canManage = Boolean(authorization?.platformAdmin || (authorization?.role && organizationRoleHasPermission(authorization.role, 'inventory:manage')));
  if (!canRead) return <section className="sf-inventory-empty"><p className="sf-eyebrow">Inventory</p><h1>Amenity access is restricted</h1><p>Your organization role does not include inventory access.</p></section>;

  const amenities = await listHospitalityAmenities({ organizationId: organization.id, actorUserId: session.user.id });

  return <div className="sf-inventory-page">
    <header className="sf-inventory-page__header"><div><Link className="sf-back-link" href="/inventory">← Inventory</Link><p className="sf-eyebrow">Hospitality inventory</p><h1>Amenities</h1><p>Maintain reusable tenant-owned amenities and assign them to properties or room types.</p></div><span className="sf-inventory-count">{amenities.length} amenities</span></header>
    {query.status && statuses[query.status] ? <p className="sf-alert sf-alert--success" role="status">{statuses[query.status]}</p> : null}
    {query.error && errors[query.error] ? <p className="sf-alert sf-alert--error" role="alert">{errors[query.error]}</p> : null}

    <div className={`sf-inventory-layout${canManage ? '' : ' sf-inventory-layout--single'}`}>
      <section className="sf-inventory-card" aria-labelledby="amenities-title">
        <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Reusable definitions</p><h2 id="amenities-title">Amenity records</h2></div><span>{amenities.length} total</span></div>
        {amenities.length === 0 ? <div className="sf-empty-state"><h3>No amenities yet</h3><p>{canManage ? 'Create reusable amenities before assigning them to properties or room types.' : 'No amenities are configured for this tenant.'}</p></div> : <div className="sf-room-table-wrap"><table className="sf-room-table"><thead><tr><th scope="col">Amenity</th><th scope="col">Code</th><th scope="col">Assignments</th><th scope="col">Status</th>{canManage ? <th scope="col">Action</th> : null}</tr></thead><tbody>{amenities.map((amenity) => <tr key={amenity.id}><th scope="row">{amenity.name}</th><td>{amenity.code}</td><td>{amenity._count.propertyAssignments} properties · {amenity._count.roomTypeAssignments} room types</td><td><span className={`sf-status-badge${amenity.status === 'ARCHIVED' ? ' sf-status-badge--muted' : ''}`}>{amenity.status.toLowerCase()}</span></td>{canManage ? <td>{amenity.status === 'ACTIVE' ? <form action={`/api/inventory/amenities/${amenity.id}/archive`} method="post" className="sf-archive-inline"><input className="sf-archive-inline__input" name="confirmation" aria-label={`Type ARCHIVE to archive amenity ${amenity.name}`} placeholder="ARCHIVE" required /><button className="sf-button sf-button--danger sf-button--compact" type="submit">Archive</button></form> : '—'}</td> : null}</tr>)}</tbody></table></div>}
      </section>
      {canManage ? <aside className="sf-inventory-card sf-inventory-card--create"><p className="sf-eyebrow">New amenity</p><h2>Create amenity</h2><p>Codes are tenant-local and remain stable for later public search and filtering.</p><form className="sf-form" action="/api/inventory/amenities" method="post"><label className="sf-field">Amenity name<input name="name" maxLength={120} required /></label><label className="sf-field">Code<input name="code" maxLength={32} required autoCapitalize="characters" /></label><button className="sf-button sf-button--primary" type="submit">Create amenity</button></form></aside> : null}
    </div>
  </div>;
}
