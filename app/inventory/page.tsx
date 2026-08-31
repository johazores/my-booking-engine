import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { organizationRoleHasPermission } from '@/server/authorization/authorization-domain.ts';
import { readOrganizationAuthorization } from '@/server/authorization/authorization-service.ts';
import { parseInventoryPage, parseInventoryPageSize } from '@/server/inventory/hospitality-domain.ts';
import { listHospitalityProperties } from '@/server/inventory/hospitality-service.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

const errors: Record<string, string> = {
  tenant: 'Choose an active organization before managing inventory.',
  permission: 'You do not have permission to manage inventory.',
  conflict: 'That inventory code is already in use.',
  dependency: 'Archive dependent inventory first.',
  unavailable: 'That inventory record is not available in this organization.',
  validation: 'Check the inventory details and try again.',
  server: 'The inventory operation could not be completed. Try again.',
};
const statuses: Record<string, string> = { 'property-archived': 'Property archived after dependent inventory was cleared.' };

function hrefForPage(page: number, pageSize: number) {
  const params = new URLSearchParams();
  if (page > 1) params.set('page', String(page));
  if (pageSize !== 20) params.set('pageSize', String(pageSize));
  const query = params.toString();
  return query ? `/inventory?${query}` : '/inventory';
}

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ page?: string; pageSize?: string; status?: string; error?: string }> }) {
  const authState = await readAuthSessionState();
  const authRedirect = getAuthRequiredRedirect(authState);
  if (authRedirect) redirect(authRedirect);
  const session = authState.session;
  if (!session) throw new Error('Authenticated inventory guard returned without a session');
  const params = await searchParams;
  const activeContext = await readActiveOrganizationContext(session.user.id);
  const authorization = activeContext.organization ? await readOrganizationAuthorization({ organizationId: activeContext.organization.id, userId: session.user.id }) : null;
  const canRead = Boolean(authorization?.platformAdmin || (authorization?.role && organizationRoleHasPermission(authorization.role, 'inventory:read')));
  const canManage = Boolean(authorization?.platformAdmin || (authorization?.role && organizationRoleHasPermission(authorization.role, 'inventory:manage')));

  if (!activeContext.organization) return <section className="sf-inventory-empty"><p className="sf-eyebrow">Inventory</p><h1>Select an organization first</h1><p>Inventory is tenant-owned and requires an active organization.</p><Link className="sf-button sf-button--primary" href="/account">Choose organization</Link></section>;
  if (!canRead) return <section className="sf-inventory-empty"><p className="sf-eyebrow">Inventory</p><h1>Inventory access is restricted</h1><p>Your organization role does not include inventory access.</p></section>;

  const pageSize = parseInventoryPageSize(params.pageSize);
  const result = await listHospitalityProperties({ organizationId: activeContext.organization.id, actorUserId: session.user.id, page: parseInventoryPage(params.page), pageSize });
  const first = result.total === 0 ? 0 : (result.page - 1) * pageSize + 1;
  const last = Math.min(result.page * pageSize, result.total);

  return <div className="sf-inventory-page">
    <header className="sf-inventory-page__header"><div><p className="sf-eyebrow">Hospitality inventory</p><h1>Properties</h1><p>Manage the real property → room type → room hierarchy for {activeContext.organization.name}.</p></div><span className="sf-inventory-count">{result.total} properties</span></header>
    {params.status && statuses[params.status] ? <p className="sf-alert sf-alert--success" role="status">{statuses[params.status]}</p> : null}
    {params.error && errors[params.error] ? <p className="sf-alert sf-alert--error" role="alert">{errors[params.error]}</p> : null}
    <div className={`sf-inventory-layout${canManage ? '' : ' sf-inventory-layout--single'}`}>
      <section className="sf-inventory-card" aria-labelledby="properties-title">
        <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Portfolio</p><h2 id="properties-title">Property records</h2></div><span>{first}–{last} of {result.total}</span></div>
        {result.properties.length === 0 ? <div className="sf-empty-state"><h3>No properties yet</h3><p>{canManage ? 'Create the first property to establish hospitality inventory.' : 'No properties are available for this tenant.'}</p></div> : <ul className="sf-inventory-list">{result.properties.map((property) => <li key={property.id}><Link className="sf-inventory-list__link" href={`/inventory/${property.id}`}><div><strong>{property.name}</strong><span>{property.code} · {property.city ?? property.countryCode}</span></div><div className="sf-inventory-list__meta"><span className={`sf-status-badge${property.status === 'ARCHIVED' ? ' sf-status-badge--muted' : ''}`}>{property.status.toLowerCase()}</span><span>{property._count.roomTypes} room types</span></div></Link></li>)}</ul>}
        {result.total > pageSize ? <nav className="sf-pagination" aria-label="Property pages">{result.page > 1 ? <Link className="sf-button sf-button--secondary sf-button--compact" href={hrefForPage(result.page - 1, pageSize)}>Previous</Link> : <span />}<span>Page {result.page} of {result.totalPages}</span>{result.page < result.totalPages ? <Link className="sf-button sf-button--secondary sf-button--compact" href={hrefForPage(result.page + 1, pageSize)}>Next</Link> : <span />}</nav> : null}
      </section>
      {canManage ? <aside className="sf-inventory-card sf-inventory-card--create"><p className="sf-eyebrow">New property</p><h2>Create property</h2><p>Property codes are tenant-local identifiers used by later availability and booking layers.</p><form className="sf-form" action="/api/inventory/properties" method="post"><label className="sf-field">Property name<input name="name" maxLength={160} required /></label><div className="sf-form-row"><label className="sf-field">Code<input name="code" maxLength={32} required autoCapitalize="characters" /></label><label className="sf-field">Country code<input name="countryCode" maxLength={2} minLength={2} required defaultValue="PH" autoCapitalize="characters" /></label></div><label className="sf-field">Timezone<input name="timezone" maxLength={80} required defaultValue={activeContext.organization.timezone} /></label><label className="sf-field">Address<input name="addressLine1" maxLength={200} /></label><div className="sf-form-row"><label className="sf-field">City<input name="city" maxLength={120} /></label><label className="sf-field">Region<input name="region" maxLength={120} /></label></div><label className="sf-field">Postal code<input name="postalCode" maxLength={24} /></label><button className="sf-button sf-button--primary" type="submit">Create property</button></form></aside> : null}
    </div>
  </div>;
}
