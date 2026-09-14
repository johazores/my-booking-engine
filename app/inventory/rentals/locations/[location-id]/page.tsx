import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { organizationRoleHasPermission } from '@/server/authorization/authorization-domain.ts';
import { readOrganizationAuthorization } from '@/server/authorization/authorization-service.ts';
import { parseInventoryPage, parseInventoryPageSize } from '@/server/inventory/hospitality-domain.ts';
import { RentalInventoryUnavailableError, readRentalLocationInventory } from '@/server/inventory/rental-service.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

const errors: Record<string, string> = {
  permission: 'You do not have permission to manage rental inventory.',
  conflict: 'That rental inventory record conflicts with existing inventory.',
  dependency: 'Move or archive active rental units before archiving this location.',
  unavailable: 'That rental location is not available in this organization.',
  validation: 'Check the rental location details and try again.',
  server: 'The rental inventory operation could not be completed. Try again.',
};
const statuses: Record<string, string> = {
  'location-created': 'Rental location created.',
};

function locationHref(locationId: string, unitPage: number, pageSize: number) {
  const params = new URLSearchParams();
  if (unitPage > 1) params.set('unitPage', String(unitPage));
  if (pageSize !== 20) params.set('pageSize', String(pageSize));
  const query = params.toString();
  const path = `/inventory/rentals/locations/${encodeURIComponent(locationId)}`;
  return query ? `${path}?${query}` : path;
}

export default async function RentalLocationPage({
  params,
  searchParams,
}: {
  params: Promise<{ 'location-id': string }>;
  searchParams: Promise<{ unitPage?: string; pageSize?: string; status?: string; error?: string }>;
}) {
  const authState = await readAuthSessionState();
  const authRedirect = getAuthRequiredRedirect(authState);
  if (authRedirect) redirect(authRedirect);
  const session = authState.session;
  if (!session) throw new Error('Authenticated rental location guard returned without a session');
  const routeParams = await params;
  const query = await searchParams;
  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) redirect('/inventory?error=tenant');
  const authorization = await readOrganizationAuthorization({ organizationId: activeContext.organization.id, userId: session.user.id });
  const canManage = Boolean(authorization.platformAdmin || (authorization.role && organizationRoleHasPermission(authorization.role, 'inventory:manage')));
  const pageSize = parseInventoryPageSize(query.pageSize);

  let inventory;
  try {
    inventory = await readRentalLocationInventory({
      organizationId: activeContext.organization.id,
      actorUserId: session.user.id,
      locationId: routeParams['location-id'],
      unitPage: parseInventoryPage(query.unitPage),
      pageSize,
    });
  } catch (error) {
    if (error instanceof RentalInventoryUnavailableError) notFound();
    throw error;
  }

  const address = [inventory.location.addressLine1, inventory.location.addressLine2, inventory.location.city, inventory.location.region, inventory.location.postalCode, inventory.location.countryCode].filter(Boolean).join(', ');

  return <div className="sf-inventory-page">
    <header className="sf-inventory-page__header"><div><p className="sf-eyebrow">Rental location</p><h1>{inventory.location.name}</h1><p>{inventory.location.code} · {address} · {inventory.location.timeZone}</p></div><Link className="sf-button sf-button--secondary" href="/inventory/rentals">Back to rentals</Link></header>
    {query.status && statuses[query.status] ? <p className="sf-alert sf-alert--success" role="status">{statuses[query.status]}</p> : null}
    {query.error && errors[query.error] ? <p className="sf-alert sf-alert--error" role="alert">{errors[query.error]}</p> : null}

    <div className={`sf-inventory-layout${canManage ? '' : ' sf-inventory-layout--single'}`}>
      <section className="sf-inventory-card"><div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Assigned fleet</p><h2>Active units</h2></div><span>{inventory.units.total} active</span></div>
        {inventory.units.items.length === 0 ? <div className="sf-empty-state"><h3>No active units assigned</h3><p>This location can be archived when it is no longer used.</p></div> :
          <ul className="sf-inventory-list">{inventory.units.items.map((unit) => <li key={unit.id}><div className="sf-inventory-list__link"><Link className="sf-inventory-list__primary" href={`/inventory/rentals/units/${unit.id}`}><div><strong>{unit.name}</strong><span>{unit.code} · {unit.unitType.name} ({unit.unitType.code})</span></div></Link></div></li>)}</ul>}
        {inventory.units.totalPages > 1 ? <nav className="sf-pagination" aria-label="Rental units at location">{inventory.units.page > 1 ? <Link className="sf-button sf-button--secondary sf-button--compact" href={locationHref(inventory.location.id, inventory.units.page - 1, pageSize)}>Previous</Link> : <span />}<span>Page {inventory.units.page} of {inventory.units.totalPages}</span>{inventory.units.page < inventory.units.totalPages ? <Link className="sf-button sf-button--secondary sf-button--compact" href={locationHref(inventory.location.id, inventory.units.page + 1, pageSize)}>Next</Link> : <span />}</nav> : null}
      </section>
      {canManage ? <aside className="sf-inventory-card sf-inventory-card--create"><p className="sf-eyebrow">Location lifecycle</p><h2>Archive location</h2><p>Active rental units must be moved or archived first. Historical archived units can retain this location reference.</p><form className="sf-form" action={`/api/inventory/rentals/locations/${inventory.location.id}/archive`} method="post"><label className="sf-field">Type ARCHIVE to confirm<input name="confirmation" required autoComplete="off" /></label><button className="sf-button sf-button--secondary" type="submit">Archive location</button></form></aside> : null}
    </div>
  </div>;
}
