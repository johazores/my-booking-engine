import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { organizationRoleHasPermission } from '@/server/authorization/authorization-domain.ts';
import { readOrganizationAuthorization } from '@/server/authorization/authorization-service.ts';
import { parseInventoryPage, parseInventoryPageSize } from '@/server/inventory/hospitality-domain.ts';
import { listRentalAvailabilityHolds } from '@/server/inventory/rental-hold-service.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

const statuses: Record<string, string> = {
  'hold-released': 'Rental availability hold released.',
  'hold-expired': 'The rental availability hold had already expired and is no longer protecting inventory.',
};

const errors: Record<string, string> = {
  permission: 'You do not have permission to manage rental availability holds.',
  conflict: 'The rental availability hold conflicts with current inventory state.',
  unavailable: 'That rental availability hold is not available in this organization.',
  validation: 'Check the rental availability hold details and try again.',
  server: 'The rental availability hold operation could not be completed. Try again.',
};

function holdsHref(page: number, pageSize: number) {
  const params = new URLSearchParams();
  if (page > 1) params.set('page', String(page));
  if (pageSize !== 20) params.set('pageSize', String(pageSize));
  const query = params.toString();
  return query ? `/inventory/rentals/holds?${query}` : '/inventory/rentals/holds';
}

export default async function RentalAvailabilityHoldsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; pageSize?: string; status?: string; error?: string }>;
}) {
  const authState = await readAuthSessionState();
  const authRedirect = getAuthRequiredRedirect(authState);
  if (authRedirect) redirect(authRedirect);
  const session = authState.session;
  if (!session) throw new Error('Authenticated rental hold guard returned without a session');

  const params = await searchParams;
  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) redirect('/inventory?error=tenant');

  const authorization = await readOrganizationAuthorization({
    organizationId: activeContext.organization.id,
    userId: session.user.id,
  });
  const canRead = Boolean(
    authorization.platformAdmin
      || (authorization.role && organizationRoleHasPermission(authorization.role, 'availability:read')),
  );
  const canManage = Boolean(
    authorization.platformAdmin
      || (authorization.role && organizationRoleHasPermission(authorization.role, 'availability:manage')),
  );
  if (!canRead) {
    return <section className="sf-inventory-empty"><p className="sf-eyebrow">Rental availability</p><h1>Hold access is restricted</h1><p>Your organization role does not include availability access.</p></section>;
  }

  const pageSize = parseInventoryPageSize(params.pageSize);
  const holds = await listRentalAvailabilityHolds({
    organizationId: activeContext.organization.id,
    actorUserId: session.user.id,
    page: parseInventoryPage(params.page),
    pageSize,
  });

  return <div className="sf-inventory-page">
    <header className="sf-inventory-page__header">
      <div><p className="sf-eyebrow">Rental availability</p><h1>Active temporary holds</h1><p>Review short-lived physical-unit holds and their creation-time pricing evidence for {activeContext.organization.name}.</p></div>
      <div className="sf-image-scope__nav"><Link className="sf-button sf-button--primary" href="/inventory/rentals/availability">Availability preview</Link><Link className="sf-button sf-button--secondary" href="/inventory/rentals">Rental inventory</Link></div>
    </header>

    {params.status && statuses[params.status] ? <p className="sf-alert sf-alert--success" role="status">{statuses[params.status]}</p> : null}
    {params.error && errors[params.error] ? <p className="sf-alert sf-alert--error" role="alert">{errors[params.error]}</p> : null}

    <section className="sf-inventory-card" aria-labelledby="rental-holds-title">
      <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Inventory protection</p><h2 id="rental-holds-title">Effective holds</h2></div><span>{holds.total} active</span></div>
      <p className="sf-field-hint">Expired holds stop protecting inventory automatically even before lifecycle cleanup. Creation-time pricing is evidence only; it does not lock price or make a hold a customer reservation.</p>
      {holds.items.length === 0 ? <div className="sf-empty-state"><h3>No effective rental holds</h3><p>Use the availability preview to place a short-lived hold on an available physical unit when operational review needs temporary inventory protection.</p></div> : <ul className="sf-inventory-list">{holds.items.map((hold) => <li key={hold.id}><div className="sf-inventory-list__link"><Link className="sf-inventory-list__primary" href={`/inventory/rentals/holds/${hold.id}`}><div><strong>{hold.unit.name}</strong><span>{hold.unit.code} · {hold.unit.unitType.name} ({hold.unit.unitType.code}) · {hold.unit.location ? `${hold.unit.location.name} (${hold.unit.location.code})` : 'Location unavailable'}</span><span>{hold.startsOn.toISOString().slice(0, 10)} through {hold.endsOn.toISOString().slice(0, 10)} (end exclusive) · expires <time dateTime={hold.expiresAt.toISOString()}>{hold.expiresAt.toISOString()}</time></span><span>{hold.quotedCurrency && hold.quotedTotalMinor !== null ? `Observed quote: ${hold.quotedCurrency} ${hold.quotedTotalMinor.toString()} minor units` : 'Legacy hold without creation-time pricing evidence'}</span></div></Link>{canManage ? <form action={`/api/inventory/rentals/holds/${hold.id}/release`} method="post"><button className="sf-button sf-button--secondary sf-button--compact" type="submit">Release hold</button></form> : null}</div></li>)}</ul>}
      {holds.totalPages > 1 ? <nav className="sf-pagination" aria-label="Rental availability hold pages">{holds.page > 1 ? <Link className="sf-button sf-button--secondary sf-button--compact" href={holdsHref(holds.page - 1, pageSize)}>Previous</Link> : <span />}<span>Page {holds.page} of {holds.totalPages}</span>{holds.page < holds.totalPages ? <Link className="sf-button sf-button--secondary sf-button--compact" href={holdsHref(holds.page + 1, pageSize)}>Next</Link> : <span />}</nav> : null}
    </section>
  </div>;
}
