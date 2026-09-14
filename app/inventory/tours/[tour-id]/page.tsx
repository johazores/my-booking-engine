import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { organizationRoleHasPermission } from '@/server/authorization/authorization-domain.ts';
import { readOrganizationAuthorization } from '@/server/authorization/authorization-service.ts';
import { readTourProduct, TourInventoryUnavailableError } from '@/server/inventory/tour-service.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

const errors: Record<string, string> = {
  tenant: 'Choose an active organization before managing tour inventory.',
  permission: 'You do not have permission to manage tour inventory.',
  conflict: 'That schedule or add-on already exists in this scope.',
  dependency: 'Archive active departures and add-ons before archiving the tour or package.',
  unavailable: 'That tour inventory record is not available in this organization.',
  validation: 'Check the tour inventory details and try again.',
  server: 'The tour inventory operation could not be completed. Try again.',
};

const statuses: Record<string, string> = {
  created: 'Tour or package created.',
  'departure-created': 'Departure schedule and capacity created.',
  'departure-archived': 'Departure archived.',
  'addon-created': 'Add-on created.',
  'addon-archived': 'Add-on archived.',
};

function formatLocalDateTime(date: Date, timezone: string) {
  return new Intl.DateTimeFormat('en-AU', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(date);
}

export default async function TourInventoryDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ 'tour-id': string }>;
  searchParams: Promise<{ status?: string; error?: string }>;
}) {
  const authState = await readAuthSessionState();
  const authRedirect = getAuthRequiredRedirect(authState);
  if (authRedirect) redirect(authRedirect);
  const session = authState.session;
  if (!session) throw new Error('Authenticated tour inventory guard returned without a session');

  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) redirect('/inventory/tours?error=tenant');
  const authorization = await readOrganizationAuthorization({ organizationId: activeContext.organization.id, userId: session.user.id });
  const canRead = Boolean(
    authorization?.platformAdmin ||
      (authorization?.role && organizationRoleHasPermission(authorization.role, 'inventory:read')),
  );
  const canManage = Boolean(
    authorization?.platformAdmin ||
      (authorization?.role && organizationRoleHasPermission(authorization.role, 'inventory:manage')),
  );
  if (!canRead) {
    return <section className="sf-inventory-empty">
      <p className="sf-eyebrow">Tour inventory</p>
      <h1>Tour inventory access is restricted</h1>
      <p>Your organization role does not include inventory access.</p>
    </section>;
  }

  const routeParams = await params;
  let product: Awaited<ReturnType<typeof readTourProduct>>;
  try {
    product = await readTourProduct({
      organizationId: activeContext.organization.id,
      actorUserId: session.user.id,
      tourProductId: routeParams['tour-id'],
    });
  } catch (error) {
    if (error instanceof TourInventoryUnavailableError) notFound();
    throw error;
  }
  const query = await searchParams;
  const isActive = product.status === 'ACTIVE';

  return <div className="sf-inventory-page">
    <header className="sf-inventory-page__header">
      <div>
        <p className="sf-eyebrow">{product.kind === 'PACKAGE' ? 'Tour package' : 'Tour product'}</p>
        <h1>{product.name}</h1>
        <p>{product.code} · {product.timezone}{product.meetingPoint ? ` · ${product.meetingPoint}` : ''}</p>
      </div>
      <div className="sf-image-scope__nav">
        <span className={`sf-status-badge${isActive ? '' : ' sf-status-badge--muted'}`}>{product.status.toLowerCase()}</span>
        <Link className="sf-button sf-button--secondary" href="/inventory/tours">Back to tours</Link>
      </div>
    </header>

    {query.status && statuses[query.status] ? <p className="sf-alert sf-alert--success" role="status">{statuses[query.status]}</p> : null}
    {query.error && errors[query.error] ? <p className="sf-alert sf-alert--error" role="alert">{errors[query.error]}</p> : null}
    {product.description ? <section className="sf-inventory-card"><p className="sf-eyebrow">Description</p><p>{product.description}</p></section> : null}

    <div className="sf-inventory-layout">
      <section className="sf-inventory-card" aria-labelledby="departures-title">
        <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Schedule and capacity</p><h2 id="departures-title">Departures</h2></div><span>{product.departures.length}</span></div>
        {product.departures.length === 0 ? <div className="sf-empty-state"><h3>No departures yet</h3><p>Create a dated departure before later availability and booking layers can allocate capacity.</p></div> : <ul className="sf-inventory-list">{product.departures.map((departure) => <li key={departure.id}>
          <div className="sf-inventory-list__link">
            <div className="sf-inventory-list__primary"><div><strong>{formatLocalDateTime(departure.startsAt, product.timezone)}</strong><span>Ends {formatLocalDateTime(departure.endsAt, product.timezone)} · capacity {departure.capacity}</span></div></div>
            <div className="sf-inventory-list__meta">
              <span className={`sf-status-badge${departure.status === 'ARCHIVED' ? ' sf-status-badge--muted' : ''}`}>{departure.status.toLowerCase()}</span>
              {canManage && departure.status === 'ACTIVE' ? <form className="sf-form sf-form--inline" action={`/api/inventory/tours/${product.id}/departures/${departure.id}/archive`} method="post"><label className="sf-field">Confirm<input name="confirmation" required placeholder="ARCHIVE" autoCapitalize="characters" /></label><button className="sf-button sf-button--secondary sf-button--compact" type="submit">Archive departure</button></form> : null}
            </div>
          </div>
        </li>)}</ul>}
      </section>

      <section className="sf-inventory-card" aria-labelledby="addons-title">
        <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Optional inventory</p><h2 id="addons-title">Add-ons</h2></div><span>{product.addons.length}</span></div>
        {product.addons.length === 0 ? <div className="sf-empty-state"><h3>No add-ons yet</h3><p>Add optional product components without inventing pricing or provider behavior.</p></div> : <ul className="sf-inventory-list">{product.addons.map((addon) => <li key={addon.id}>
          <div className="sf-inventory-list__link">
            <div className="sf-inventory-list__primary"><div><strong>{addon.name}</strong><span>{addon.code} · max {addon.maxQuantityPerBooking} per booking{addon.description ? ` · ${addon.description}` : ''}</span></div></div>
            <div className="sf-inventory-list__meta">
              <span className={`sf-status-badge${addon.status === 'ARCHIVED' ? ' sf-status-badge--muted' : ''}`}>{addon.status.toLowerCase()}</span>
              {canManage && addon.status === 'ACTIVE' ? <form className="sf-form sf-form--inline" action={`/api/inventory/tours/${product.id}/addons/${addon.id}/archive`} method="post"><label className="sf-field">Confirm<input name="confirmation" required placeholder="ARCHIVE" autoCapitalize="characters" /></label><button className="sf-button sf-button--secondary sf-button--compact" type="submit">Archive add-on</button></form> : null}
            </div>
          </div>
        </li>)}</ul>}
      </section>
    </div>

    {canManage && isActive ? <div className="sf-inventory-layout">
      <section className="sf-inventory-card sf-inventory-card--create">
        <p className="sf-eyebrow">New departure</p><h2>Schedule capacity</h2>
        <p>Use an RFC 3339 timestamp with an explicit offset, for example <code>2026-10-05T08:00:00+08:00</code>. The product timezone is {product.timezone}.</p>
        <form className="sf-form" action={`/api/inventory/tours/${product.id}/departures`} method="post">
          <label className="sf-field">Starts at<input name="startsAt" maxLength={40} required placeholder="2026-10-05T08:00:00+08:00" /></label>
          <label className="sf-field">Ends at<input name="endsAt" maxLength={40} required placeholder="2026-10-05T17:00:00+08:00" /></label>
          <label className="sf-field">Capacity<input name="capacity" type="number" min={1} max={10000} step={1} required /></label>
          <button className="sf-button sf-button--primary" type="submit">Create departure</button>
        </form>
      </section>

      <section className="sf-inventory-card sf-inventory-card--create">
        <p className="sf-eyebrow">New add-on</p><h2>Create add-on</h2>
        <p>Add-ons are inventory definitions only here. Pricing stays behind the pricing layer rather than being faked on this surface.</p>
        <form className="sf-form" action={`/api/inventory/tours/${product.id}/addons`} method="post">
          <label className="sf-field">Name<input name="name" maxLength={120} required /></label>
          <label className="sf-field">Code<input name="code" maxLength={32} required autoCapitalize="characters" /></label>
          <label className="sf-field">Maximum quantity per booking<input name="maxQuantityPerBooking" type="number" min={1} max={100} step={1} defaultValue={1} required /></label>
          <label className="sf-field">Description<textarea name="description" maxLength={500} rows={3} /></label>
          <button className="sf-button sf-button--primary" type="submit">Create add-on</button>
        </form>
      </section>
    </div> : null}

    {canManage && isActive ? <section className="sf-inventory-card">
      <p className="sf-eyebrow">Lifecycle</p><h2>Archive tour or package</h2>
      <p>Archive all active departures and add-ons first. Historical rows remain immutable inventory evidence.</p>
      <form className="sf-form sf-form--inline" action={`/api/inventory/tours/${product.id}/archive`} method="post">
        <label className="sf-field">Type ARCHIVE to confirm<input name="confirmation" required autoCapitalize="characters" /></label>
        <button className="sf-button sf-button--secondary" type="submit">Archive product</button>
      </form>
    </section> : null}
  </div>;
}
