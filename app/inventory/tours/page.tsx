import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { organizationRoleHasPermission } from '@/server/authorization/authorization-domain.ts';
import { readOrganizationAuthorization } from '@/server/authorization/authorization-service.ts';
import { parseInventoryPage, parseInventoryPageSize } from '@/server/inventory/hospitality-domain.ts';
import { listTourProducts } from '@/server/inventory/tour-service.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

const errors: Record<string, string> = {
  tenant: 'Choose an active organization before managing tour inventory.',
  permission: 'You do not have permission to manage tour inventory.',
  conflict: 'That tour inventory code is already in use.',
  dependency: 'Archive dependent tour inventory first.',
  unavailable: 'That tour inventory record is not available in this organization.',
  validation: 'Check the tour inventory details and try again.',
  server: 'The tour inventory operation could not be completed. Try again.',
};

const statuses: Record<string, string> = {
  'product-archived': 'Tour or package archived after its active departures and add-ons were cleared.',
};

function hrefForPage(page: number, pageSize: number) {
  const params = new URLSearchParams();
  if (page > 1) params.set('page', String(page));
  if (pageSize !== 20) params.set('pageSize', String(pageSize));
  const query = params.toString();
  return query ? `/inventory/tours?${query}` : '/inventory/tours';
}

export default async function TourInventoryPage({ searchParams }: {
  searchParams: Promise<{ page?: string; pageSize?: string; status?: string; error?: string }>;
}) {
  const authState = await readAuthSessionState();
  const authRedirect = getAuthRequiredRedirect(authState);
  if (authRedirect) redirect(authRedirect);
  const session = authState.session;
  if (!session) throw new Error('Authenticated tour inventory guard returned without a session');

  const params = await searchParams;
  const activeContext = await readActiveOrganizationContext(session.user.id);
  const authorization = activeContext.organization
    ? await readOrganizationAuthorization({ organizationId: activeContext.organization.id, userId: session.user.id })
    : null;
  const canRead = Boolean(
    authorization?.platformAdmin ||
      (authorization?.role && organizationRoleHasPermission(authorization.role, 'inventory:read')),
  );
  const canManage = Boolean(
    authorization?.platformAdmin ||
      (authorization?.role && organizationRoleHasPermission(authorization.role, 'inventory:manage')),
  );

  if (!activeContext.organization) {
    return <section className="sf-inventory-empty">
      <p className="sf-eyebrow">Tour inventory</p>
      <h1>Select an organization first</h1>
      <p>Tour inventory is tenant-owned and requires an active organization.</p>
      <Link className="sf-button sf-button--primary" href="/account">Choose organization</Link>
    </section>;
  }
  if (!canRead) {
    return <section className="sf-inventory-empty">
      <p className="sf-eyebrow">Tour inventory</p>
      <h1>Tour inventory access is restricted</h1>
      <p>Your organization role does not include inventory access.</p>
    </section>;
  }

  const pageSize = parseInventoryPageSize(params.pageSize);
  const result = await listTourProducts({
    organizationId: activeContext.organization.id,
    actorUserId: session.user.id,
    page: parseInventoryPage(params.page),
    pageSize,
  });
  const first = result.total === 0 ? 0 : (result.page - 1) * pageSize + 1;
  const last = Math.min(result.page * pageSize, result.total);

  return <div className="sf-inventory-page">
    <header className="sf-inventory-page__header">
      <div>
        <p className="sf-eyebrow">Tours and packages</p>
        <h1>Tour inventory</h1>
        <p>Manage tenant-owned products, scheduled departures, capacity, and add-ons for {activeContext.organization.name}.</p>
      </div>
      <div className="sf-image-scope__nav">
        <span className="sf-inventory-count">{result.total} products</span>
        <Link className="sf-button sf-button--secondary" href="/inventory">Hospitality inventory</Link>
      </div>
    </header>

    {params.status && statuses[params.status] ? <p className="sf-alert sf-alert--success" role="status">{statuses[params.status]}</p> : null}
    {params.error && errors[params.error] ? <p className="sf-alert sf-alert--error" role="alert">{errors[params.error]}</p> : null}

    <div className={`sf-inventory-layout${canManage ? '' : ' sf-inventory-layout--single'}`}>
      <section className="sf-inventory-card" aria-labelledby="tour-products-title">
        <div className="sf-inventory-card__heading">
          <div><p className="sf-eyebrow">Catalog</p><h2 id="tour-products-title">Tour and package records</h2></div>
          <span>{first}–{last} of {result.total}</span>
        </div>
        {result.products.length === 0
          ? <div className="sf-empty-state"><h3>No tour products yet</h3><p>{canManage ? 'Create the first tour or package to establish scheduled-capacity inventory.' : 'No tour products are available for this tenant.'}</p></div>
          : <ul className="sf-inventory-list">{result.products.map((product) => <li key={product.id}>
            <div className="sf-inventory-list__link">
              <Link className="sf-inventory-list__primary" href={`/inventory/tours/${product.id}`}>
                <div><strong>{product.name}</strong><span>{product.code} · {product.kind === 'PACKAGE' ? 'Package' : 'Tour'} · {product.timezone}</span></div>
              </Link>
              <div className="sf-inventory-list__meta">
                <span className={`sf-status-badge${product.status === 'ARCHIVED' ? ' sf-status-badge--muted' : ''}`}>{product.status.toLowerCase()}</span>
                <span>{product._count.departures} departures</span>
                <span>{product._count.addons} add-ons</span>
              </div>
            </div>
          </li>)}</ul>}
        {result.total > pageSize ? <nav className="sf-pagination" aria-label="Tour product pages">
          {result.page > 1 ? <Link className="sf-button sf-button--secondary sf-button--compact" href={hrefForPage(result.page - 1, pageSize)}>Previous</Link> : <span />}
          <span>Page {result.page} of {result.totalPages}</span>
          {result.page < result.totalPages ? <Link className="sf-button sf-button--secondary sf-button--compact" href={hrefForPage(result.page + 1, pageSize)}>Next</Link> : <span />}
        </nav> : null}
      </section>

      {canManage ? <aside className="sf-inventory-card sf-inventory-card--create">
        <p className="sf-eyebrow">New tour inventory</p>
        <h2>Create tour or package</h2>
        <p>Product codes are tenant-local. Pricing and booking allocation remain separate later layers.</p>
        <form className="sf-form" action="/api/inventory/tours" method="post">
          <label className="sf-field">Type<select name="kind" defaultValue="TOUR"><option value="TOUR">Tour</option><option value="PACKAGE">Package</option></select></label>
          <label className="sf-field">Name<input name="name" maxLength={160} required /></label>
          <label className="sf-field">Code<input name="code" maxLength={32} required autoCapitalize="characters" /></label>
          <label className="sf-field">Timezone<input name="timezone" maxLength={80} required defaultValue={activeContext.organization.timezone} /></label>
          <label className="sf-field">Meeting point<input name="meetingPoint" maxLength={300} /></label>
          <label className="sf-field">Description<textarea name="description" maxLength={1000} rows={4} /></label>
          <button className="sf-button sf-button--primary" type="submit">Create tour inventory</button>
        </form>
      </aside> : null}
    </div>
  </div>;
}
