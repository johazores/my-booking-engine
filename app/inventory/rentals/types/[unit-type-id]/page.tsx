import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { organizationRoleHasPermission } from '@/server/authorization/authorization-domain.ts';
import { readOrganizationAuthorization } from '@/server/authorization/authorization-service.ts';
import { parseInventoryPage, parseInventoryPageSize } from '@/server/inventory/hospitality-domain.ts';
import { RentalInventoryUnavailableError, readRentalUnitTypeInventory } from '@/server/inventory/rental-service.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

const errors: Record<string, string> = {
  permission: 'You do not have permission to manage rental inventory.',
  conflict: 'That date range or unit code conflicts with existing rental inventory.',
  dependency: 'Clear dependent rental inventory before archiving this record.',
  unavailable: 'That rental inventory record or location is not available in this organization.',
  validation: 'Check the rental inventory details and try again.',
  server: 'The rental inventory operation could not be completed. Try again.',
};
const statuses: Record<string, string> = {
  'unit-created': 'Rental unit created.',
  'rate-created': 'Pricing period created.',
  'rate-removed': 'Pricing period removed.',
};

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function unitTypeHref(unitTypeId: string, unitPage: number, ratePage: number, pageSize: number) {
  const params = new URLSearchParams();
  if (unitPage > 1) params.set('unitPage', String(unitPage));
  if (ratePage > 1) params.set('ratePage', String(ratePage));
  if (pageSize !== 20) params.set('pageSize', String(pageSize));
  const query = params.toString();
  const path = `/inventory/rentals/types/${encodeURIComponent(unitTypeId)}`;
  return query ? `${path}?${query}` : path;
}

export default async function RentalUnitTypePage({
  params,
  searchParams,
}: {
  params: Promise<{ 'unit-type-id': string }>;
  searchParams: Promise<{ unitPage?: string; ratePage?: string; pageSize?: string; status?: string; error?: string }>;
}) {
  const authState = await readAuthSessionState();
  const authRedirect = getAuthRequiredRedirect(authState);
  if (authRedirect) redirect(authRedirect);
  const session = authState.session;
  if (!session) throw new Error('Authenticated rental unit type guard returned without a session');
  const routeParams = await params;
  const query = await searchParams;
  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) redirect('/inventory?error=tenant');
  const authorization = await readOrganizationAuthorization({ organizationId: activeContext.organization.id, userId: session.user.id });
  const canManage = Boolean(authorization.platformAdmin || (authorization.role && organizationRoleHasPermission(authorization.role, 'inventory:manage')));
  const pageSize = parseInventoryPageSize(query.pageSize);

  let inventory;
  try {
    inventory = await readRentalUnitTypeInventory({
      organizationId: activeContext.organization.id,
      actorUserId: session.user.id,
      unitTypeId: routeParams['unit-type-id'],
      unitPage: parseInventoryPage(query.unitPage),
      ratePage: parseInventoryPage(query.ratePage),
      pageSize,
    });
  } catch (error) {
    if (error instanceof RentalInventoryUnavailableError) notFound();
    throw error;
  }

  return <div className="sf-inventory-page">
    <header className="sf-inventory-page__header"><div><p className="sf-eyebrow">Rental unit type</p><h1>{inventory.unitType.name}</h1><p>{inventory.unitType.code} · {inventory.unitType.currency} · default {inventory.unitType.defaultDailyRateMinor} minor units/day</p></div><Link className="sf-button sf-button--secondary" href="/inventory/rentals">Back to rentals</Link></header>
    {query.status && statuses[query.status] ? <p className="sf-alert sf-alert--success" role="status">{statuses[query.status]}</p> : null}
    {query.error && errors[query.error] ? <p className="sf-alert sf-alert--error" role="alert">{errors[query.error]}</p> : null}

    <div className={`sf-inventory-layout${canManage ? '' : ' sf-inventory-layout--single'}`}>
      <section className="sf-inventory-card"><div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Units</p><h2>Physical rental units</h2></div><span>{inventory.units.total} active</span></div>
        {inventory.units.items.length === 0 ? <div className="sf-empty-state"><h3>No units yet</h3><p>Add the first physical unit for this type after creating an operating location.</p></div> :
          <ul className="sf-inventory-list">{inventory.units.items.map((unit) => <li key={unit.id}><div className="sf-inventory-list__link"><Link className="sf-inventory-list__primary" href={`/inventory/rentals/units/${unit.id}`}><div><strong>{unit.name}</strong><span>{unit.code} · {unit.location ? `${unit.location.name} (${unit.location.code})` : 'Location not assigned'}</span></div></Link></div></li>)}</ul>}
        {inventory.units.totalPages > 1 ? <nav className="sf-pagination" aria-label="Rental units for unit type">{inventory.units.page > 1 ? <Link className="sf-button sf-button--secondary sf-button--compact" href={unitTypeHref(inventory.unitType.id, inventory.units.page - 1, inventory.rates.page, pageSize)}>Previous</Link> : <span />}<span>Page {inventory.units.page} of {inventory.units.totalPages}</span>{inventory.units.page < inventory.units.totalPages ? <Link className="sf-button sf-button--secondary sf-button--compact" href={unitTypeHref(inventory.unitType.id, inventory.units.page + 1, inventory.rates.page, pageSize)}>Next</Link> : <span />}</nav> : null}
      </section>
      {canManage ? <aside className="sf-inventory-card sf-inventory-card--create"><p className="sf-eyebrow">New unit</p><h2>Add physical unit</h2><p>Assign each new unit to an active tenant location by its location code.</p><form className="sf-form" action="/api/inventory/rentals/units" method="post"><input type="hidden" name="unitTypeId" value={inventory.unitType.id} /><label className="sf-field">Name<input name="name" maxLength={160} required /></label><label className="sf-field">Code<input name="code" maxLength={32} required autoCapitalize="characters" /></label><label className="sf-field">Location code<input name="locationCode" maxLength={32} required autoCapitalize="characters" aria-describedby="rental-location-code-help" /></label><p id="rental-location-code-help" className="sf-field-hint">Use an active location code from the rental inventory page.</p><label className="sf-field">Description<textarea name="description" maxLength={1000} rows={3} /></label><button className="sf-button sf-button--primary" type="submit">Add unit</button></form></aside> : null}
    </div>

    <div className={`sf-inventory-layout${canManage ? '' : ' sf-inventory-layout--single'}`}>
      <section className="sf-inventory-card"><div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Pricing calendar</p><h2>Daily price overrides</h2></div><span>{inventory.rates.total} periods</span></div>
        {inventory.rates.items.length === 0 ? <div className="sf-empty-state"><h3>No overrides</h3><p>The default daily rate applies until a date-range override is added.</p></div> :
          <ul className="sf-inventory-list">{inventory.rates.items.map((rate) => <li key={rate.id}><div className="sf-inventory-list__link"><div className="sf-inventory-list__primary"><div><strong>{rate.dailyRateMinor} minor units/day</strong><span>{dateOnly(rate.startsOn)} through {dateOnly(rate.endsOn)} (end exclusive)</span></div></div>{canManage ? <form className="sf-form" action={`/api/inventory/rentals/unit-types/${inventory.unitType.id}/rates/${rate.id}/remove`} method="post"><label className="sf-field">Type REMOVE to confirm<input name="confirmation" required autoComplete="off" /></label><button className="sf-button sf-button--secondary sf-button--compact" type="submit">Remove</button></form> : null}</div></li>)}</ul>}
        {inventory.rates.totalPages > 1 ? <nav className="sf-pagination" aria-label="Rental rate period pages">{inventory.rates.page > 1 ? <Link className="sf-button sf-button--secondary sf-button--compact" href={unitTypeHref(inventory.unitType.id, inventory.units.page - 1, inventory.rates.page, pageSize)}>Previous</Link> : <span />}<span>Page {inventory.rates.page} of {inventory.rates.totalPages}</span>{inventory.rates.page < inventory.rates.totalPages ? <Link className="sf-button sf-button--secondary sf-button--compact" href={unitTypeHref(inventory.unitType.id, inventory.units.page, inventory.rates.page + 1, pageSize)}>Next</Link> : <span />}</nav> : null}
      </section>
      {canManage ? <aside className="sf-inventory-card sf-inventory-card--create"><p className="sf-eyebrow">Price override</p><h2>Add pricing period</h2><form className="sf-form" action={`/api/inventory/rentals/unit-types/${inventory.unitType.id}/rates`} method="post"><label className="sf-field">Start date<input name="startsOn" type="date" required /></label><label className="sf-field">End date (exclusive)<input name="endsOn" type="date" required /></label><label className="sf-field">Daily rate (minor units)<input name="dailyRateMinor" type="number" min={1} max={100000000} step={1} required /></label><button className="sf-button sf-button--primary" type="submit">Add pricing period</button></form><hr /><form className="sf-form" action={`/api/inventory/rentals/unit-types/${inventory.unitType.id}/archive`} method="post"><label className="sf-field">Type ARCHIVE to archive this unit type<input name="confirmation" required autoComplete="off" /></label><button className="sf-button sf-button--secondary" type="submit">Archive unit type</button></form></aside> : null}
    </div>
  </div>;
}
