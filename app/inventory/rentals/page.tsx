import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { organizationRoleHasPermission } from '@/server/authorization/authorization-domain.ts';
import { readOrganizationAuthorization } from '@/server/authorization/authorization-service.ts';
import { parseInventoryPage, parseInventoryPageSize } from '@/server/inventory/hospitality-domain.ts';
import { listRentalInventory } from '@/server/inventory/rental-service.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

const errors: Record<string, string> = {
  permission: 'You do not have permission to manage rental inventory.',
  conflict: 'That rental inventory record conflicts with an existing record.',
  dependency: 'Clear dependent rental inventory before archiving this record.',
  unavailable: 'That rental inventory record is not available in this organization.',
  validation: 'Check the rental inventory details and try again.',
  server: 'The rental inventory operation could not be completed. Try again.',
};

const statuses: Record<string, string> = {
  'unit-type-created': 'Rental unit type created.',
  'unit-type-archived': 'Rental unit type archived.',
  'unit-archived': 'Rental unit archived.',
};

function money(minor: number, currency: string) {
  return `${currency} ${minor.toLocaleString()} minor units`;
}

function rentalHref(typePage: number, unitPage: number, pageSize: number) {
  const params = new URLSearchParams();
  if (typePage > 1) params.set('typePage', String(typePage));
  if (unitPage > 1) params.set('unitPage', String(unitPage));
  if (pageSize !== 20) params.set('pageSize', String(pageSize));
  const query = params.toString();
  return query ? `/inventory/rentals?${query}` : '/inventory/rentals';
}

export default async function RentalInventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ typePage?: string; unitPage?: string; pageSize?: string; status?: string; error?: string }>;
}) {
  const authState = await readAuthSessionState();
  const authRedirect = getAuthRequiredRedirect(authState);
  if (authRedirect) redirect(authRedirect);
  const session = authState.session;
  if (!session) throw new Error('Authenticated rental inventory guard returned without a session');

  const params = await searchParams;
  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) redirect('/inventory?error=tenant');

  const authorization = await readOrganizationAuthorization({
    organizationId: activeContext.organization.id,
    userId: session.user.id,
  });
  const canRead = Boolean(
    authorization.platformAdmin ||
      (authorization.role && organizationRoleHasPermission(authorization.role, 'inventory:read')),
  );
  const canManage = Boolean(
    authorization.platformAdmin ||
      (authorization.role && organizationRoleHasPermission(authorization.role, 'inventory:manage')),
  );
  if (!canRead) {
    return <section className="sf-inventory-empty"><p className="sf-eyebrow">Rental inventory</p><h1>Rental access is restricted</h1><p>Your organization role does not include inventory access.</p></section>;
  }

  const pageSize = parseInventoryPageSize(params.pageSize);
  const inventory = await listRentalInventory({
    organizationId: activeContext.organization.id,
    actorUserId: session.user.id,
    unitTypePage: parseInventoryPage(params.typePage),
    unitPage: parseInventoryPage(params.unitPage),
    pageSize,
  });

  return <div className="sf-inventory-page">
    <header className="sf-inventory-page__header">
      <div><p className="sf-eyebrow">Rental inventory</p><h1>Units and pricing</h1><p>Manage rentable unit types, physical units, daily pricing, and unavailable dates for {activeContext.organization.name}.</p></div>
      <div className="sf-image-scope__nav"><Link className="sf-button sf-button--secondary" href="/inventory">Hospitality</Link><Link className="sf-button sf-button--secondary" href="/inventory/tours">Tours</Link><Link className="sf-button sf-button--secondary" href="/inventory/appointments">Appointments</Link></div>
    </header>

    {params.status && statuses[params.status] ? <p className="sf-alert sf-alert--success" role="status">{statuses[params.status]}</p> : null}
    {params.error && errors[params.error] ? <p className="sf-alert sf-alert--error" role="alert">{errors[params.error]}</p> : null}

    <div className={`sf-inventory-layout${canManage ? '' : ' sf-inventory-layout--single'}`}>
      <section className="sf-inventory-card" aria-labelledby="rental-types-title">
        <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Catalog</p><h2 id="rental-types-title">Unit types</h2></div><span>{inventory.unitTypes.total} active</span></div>
        {inventory.unitTypes.items.length === 0 ? <div className="sf-empty-state"><h3>No rental unit types yet</h3><p>{canManage ? 'Create a unit type before adding physical rental units.' : 'No rental unit types are available for this tenant.'}</p></div> :
          <ul className="sf-inventory-list">{inventory.unitTypes.items.map((unitType) =>
            <li key={unitType.id}><div className="sf-inventory-list__link"><Link className="sf-inventory-list__primary" href={`/inventory/rentals/types/${unitType.id}`}><div><strong>{unitType.name}</strong><span>{unitType.code} · {money(unitType.defaultDailyRateMinor, unitType.currency)} / day</span></div></Link></div></li>
          )}</ul>}
        {inventory.unitTypes.totalPages > 1 ? <nav className="sf-pagination" aria-label="Rental unit type pages">{inventory.unitTypes.page > 1 ? <Link className="sf-button sf-button--secondary sf-button--compact" href={rentalHref(inventory.unitTypes.page - 1, inventory.units.page, pageSize)}>Previous</Link> : <span />}<span>Page {inventory.unitTypes.page} of {inventory.unitTypes.totalPages}</span>{inventory.unitTypes.page < inventory.unitTypes.totalPages ? <Link className="sf-button sf-button--secondary sf-button--compact" href={rentalHref(inventory.unitTypes.page + 1, inventory.units.page, pageSize)}>Next</Link> : <span />}</nav> : null}
      </section>

      {canManage ? <aside className="sf-inventory-card sf-inventory-card--create">
        <p className="sf-eyebrow">New rental type</p><h2>Create unit type</h2><p>Set a tenant-local code, currency, and default daily amount in minor units.</p>
        <form className="sf-form" action="/api/inventory/rentals/unit-types" method="post">
          <label className="sf-field">Name<input name="name" maxLength={160} required /></label>
          <label className="sf-field">Code<input name="code" maxLength={32} required autoCapitalize="characters" /></label>
          <label className="sf-field">Description<textarea name="description" maxLength={1000} rows={3} /></label>
          <div className="sf-form-row"><label className="sf-field">Currency<input name="currency" maxLength={3} minLength={3} required defaultValue="PHP" autoCapitalize="characters" /></label><label className="sf-field">Daily rate (minor units)<input name="defaultDailyRateMinor" type="number" min={1} max={100000000} step={1} required /></label></div>
          <button className="sf-button sf-button--primary" type="submit">Create unit type</button>
        </form>
      </aside> : null}
    </div>

    <section className="sf-inventory-card" aria-labelledby="rental-units-title">
      <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Fleet</p><h2 id="rental-units-title">Physical units</h2></div><span>{inventory.units.total} active</span></div>
      {inventory.units.items.length === 0 ? <div className="sf-empty-state"><h3>No rental units yet</h3><p>Add units from a unit type page.</p></div> :
        <ul className="sf-inventory-list">{inventory.units.items.map((unit) =>
          <li key={unit.id}><div className="sf-inventory-list__link"><Link className="sf-inventory-list__primary" href={`/inventory/rentals/units/${unit.id}`}><div><strong>{unit.name}</strong><span>{unit.code} · {unit.unitType.name} ({unit.unitType.code})</span></div></Link></div></li>
        )}</ul>}
      {inventory.units.totalPages > 1 ? <nav className="sf-pagination" aria-label="Rental unit pages">{inventory.units.page > 1 ? <Link className="sf-button sf-button--secondary sf-button--compact" href={rentalHref(inventory.unitTypes.page, inventory.units.page - 1, pageSize)}>Previous</Link> : <span />}<span>Page {inventory.units.page} of {inventory.units.totalPages}</span>{inventory.units.page < inventory.units.totalPages ? <Link className="sf-button sf-button--secondary sf-button--compact" href={rentalHref(inventory.unitTypes.page, inventory.units.page + 1, pageSize)}>Next</Link> : <span />}</nav> : null}
    </section>
  </div>;
}
