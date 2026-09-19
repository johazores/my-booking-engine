import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { organizationRoleHasPermission } from '@/server/authorization/authorization-domain.ts';
import { readOrganizationAuthorization } from '@/server/authorization/authorization-service.ts';
import { parseInventoryPage, parseInventoryPageSize } from '@/server/inventory/hospitality-domain.ts';
import { readRentalUnitOperationalState } from '@/server/inventory/rental-unit-operational-service.ts';
import { RentalInventoryUnavailableError, readRentalUnitInventory } from '@/server/inventory/rental-service.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

const errors: Record<string, string> = {
  permission: 'You do not have permission to manage rental inventory.',
  conflict: 'That rental inventory change conflicts with the current unit state.',
  dependency: 'Clear dependent rental inventory before archiving this record.',
  unavailable: 'That rental inventory record or location is not available in this organization.',
  validation: 'Check the rental inventory details and try again.',
  server: 'The rental inventory operation could not be completed. Try again.',
};
const statuses: Record<string, string> = {
  'unit-created': 'Rental unit created.',
  'location-assigned': 'Rental unit location updated.',
  'operational-status-updated': 'Rental unit operational status updated.',
  'block-created': 'Availability block created.',
  'block-removed': 'Availability block removed.',
};

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function unitHref(unitId: string, blockPage: number, pageSize: number) {
  const params = new URLSearchParams();
  if (blockPage > 1) params.set('blockPage', String(blockPage));
  if (pageSize !== 20) params.set('pageSize', String(pageSize));
  const query = params.toString();
  const path = `/inventory/rentals/units/${encodeURIComponent(unitId)}`;
  return query ? `${path}?${query}` : path;
}

export default async function RentalUnitPage({
  params,
  searchParams,
}: {
  params: Promise<{ 'unit-id': string }>;
  searchParams: Promise<{ blockPage?: string; pageSize?: string; status?: string; error?: string }>;
}) {
  const authState = await readAuthSessionState();
  const authRedirect = getAuthRequiredRedirect(authState);
  if (authRedirect) redirect(authRedirect);
  const session = authState.session;
  if (!session) throw new Error('Authenticated rental unit guard returned without a session');
  const routeParams = await params;
  const query = await searchParams;
  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) redirect('/inventory?error=tenant');
  const authorization = await readOrganizationAuthorization({ organizationId: activeContext.organization.id, userId: session.user.id });
  const canManage = Boolean(authorization.platformAdmin || (authorization.role && organizationRoleHasPermission(authorization.role, 'inventory:manage')));

  const pageSize = parseInventoryPageSize(query.pageSize);

  let inventory: Awaited<ReturnType<typeof readRentalUnitInventory>>;
  let operationalState: Awaited<ReturnType<typeof readRentalUnitOperationalState>>;
  try {
    [inventory, operationalState] = await Promise.all([
      readRentalUnitInventory({
        organizationId: activeContext.organization.id,
        actorUserId: session.user.id,
        unitId: routeParams['unit-id'],
        blockPage: parseInventoryPage(query.blockPage),
        pageSize,
      }),
      readRentalUnitOperationalState({
        organizationId: activeContext.organization.id,
        actorUserId: session.user.id,
        unitId: routeParams['unit-id'],
      }),
    ]);
  } catch (error) {
    if (error instanceof RentalInventoryUnavailableError) notFound();
    throw error;
  }

  return <div className="sf-inventory-page">
    <header className="sf-inventory-page__header"><div><p className="sf-eyebrow">Rental unit</p><h1>{inventory.unit.name}</h1><p>{inventory.unit.code} · {inventory.unit.unitType.name} · {inventory.unit.location ? `${inventory.unit.location.name} (${inventory.unit.location.code})` : 'Location not assigned'} · {operationalState.status === 'OUT_OF_SERVICE' ? 'Out of service' : 'Available'}</p></div><div className="sf-image-scope__nav"><Link className="sf-button sf-button--secondary" href={`/inventory/rentals/units/${inventory.unit.id}/maintenance`}>Maintenance</Link><Link className="sf-button sf-button--secondary" href={`/inventory/rentals/types/${inventory.unit.unitTypeId}`}>Unit type</Link>{inventory.unit.location ? <Link className="sf-button sf-button--secondary" href={`/inventory/rentals/locations/${inventory.unit.location.id}`}>Location</Link> : null}<Link className="sf-button sf-button--secondary" href="/inventory/rentals">All rentals</Link></div></header>
    {query.status && statuses[query.status] ? <p className="sf-alert sf-alert--success" role="status">{statuses[query.status]}</p> : null}
    {query.error && errors[query.error] ? <p className="sf-alert sf-alert--error" role="alert">{errors[query.error]}</p> : null}
    {operationalState.status === 'OUT_OF_SERVICE' ? <p className="sf-alert sf-alert--error" role="status"><strong>Out of service.</strong> {operationalState.reason}</p> : null}

    <div className={`sf-inventory-layout${canManage ? '' : ' sf-inventory-layout--single'}`}>
      <section className="sf-inventory-card"><div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Availability calendar</p><h2>Unavailable periods</h2></div><span>{inventory.blocks.total} blocks</span></div>
        {inventory.blocks.items.length === 0 ? <div className="sf-empty-state"><h3>No unavailable periods</h3><p>This unit has no explicit inventory blocks.</p></div> :
          <ul className="sf-inventory-list">{inventory.blocks.items.map((block) => <li key={block.id}><div className="sf-inventory-list__link"><div className="sf-inventory-list__primary"><div><strong>{dateOnly(block.startsOn)} through {dateOnly(block.endsOn)}</strong><span>{block.reason ?? 'Unavailable'} · end date exclusive</span></div></div>{canManage ? <form className="sf-form" action={`/api/inventory/rentals/units/${inventory.unit.id}/blocks/${block.id}/remove`} method="post"><label className="sf-field">Type REMOVE to confirm<input name="confirmation" required autoComplete="off" /></label><button className="sf-button sf-button--secondary sf-button--compact" type="submit">Remove</button></form> : null}</div></li>)}</ul>}
        {inventory.blocks.totalPages > 1 ? <nav className="sf-pagination" aria-label="Rental availability block pages">{inventory.blocks.page > 1 ? <Link className="sf-button sf-button--secondary sf-button--compact" href={unitHref(inventory.unit.id, inventory.blocks.page - 1, pageSize)}>Previous</Link> : <span />}<span>Page {inventory.blocks.page} of {inventory.blocks.totalPages}</span>{inventory.blocks.page < inventory.blocks.totalPages ? <Link className="sf-button sf-button--secondary sf-button--compact" href={unitHref(inventory.unit.id, inventory.blocks.page + 1, pageSize)}>Next</Link> : <span />}</nav> : null}
      </section>
      {canManage ? <aside className="sf-inventory-card sf-inventory-card--create"><p className="sf-eyebrow">Unit controls</p><h2>Manage unit</h2><form className="sf-form" action={`/api/inventory/rentals/units/${inventory.unit.id}/operational-status`} method="post"><label className="sf-field">Operational status<select name="status" defaultValue={operationalState.status} required><option value="AVAILABLE">Available</option><option value="OUT_OF_SERVICE">Out of service</option></select></label><label className="sf-field">Operational reason<textarea name="reason" maxLength={500} rows={3} defaultValue={operationalState.reason ?? ''} aria-describedby="rental-unit-operational-help" /></label><p id="rental-unit-operational-help" className="sf-field-hint">A reason is required when taking a unit out of service. Returning it to available clears the reason and is blocked while a return inspection is pending, maintenance work is active, or a damage case remains unresolved. Existing bookings are not cancelled automatically.</p><button className="sf-button sf-button--primary" type="submit">Update operational status</button></form><hr /><form className="sf-form" action={`/api/inventory/rentals/units/${inventory.unit.id}/blocks`} method="post"><label className="sf-field">Start date<input name="startsOn" type="date" required /></label><label className="sf-field">End date (exclusive)<input name="endsOn" type="date" required /></label><label className="sf-field">Reason<input name="reason" maxLength={500} /></label><button className="sf-button sf-button--primary" type="submit">Block dates</button></form><hr /><form className="sf-form" action={`/api/inventory/rentals/units/${inventory.unit.id}/location`} method="post"><label className="sf-field">Move to location code<input name="locationCode" maxLength={32} required autoCapitalize="characters" aria-describedby="rental-unit-location-help" /></label><p id="rental-unit-location-help" className="sf-field-hint">Use an active location code from the rental inventory page. Repeating the current location is safe.</p><button className="sf-button sf-button--secondary" type="submit">Update location</button></form><hr /><form className="sf-form" action={`/api/inventory/rentals/units/${inventory.unit.id}/archive`} method="post"><label className="sf-field">Type ARCHIVE to archive this unit<input name="confirmation" required autoComplete="off" /></label><button className="sf-button sf-button--secondary" type="submit">Archive unit</button></form></aside> : null}
    </div>
  </div>;
}