import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { organizationRoleHasPermission } from '@/server/authorization/authorization-domain.ts';
import { readOrganizationAuthorization } from '@/server/authorization/authorization-service.ts';
import { parseInventoryPage, parseInventoryPageSize } from '@/server/inventory/hospitality-domain.ts';
import { listHospitalityProperties } from '@/server/inventory/hospitality-service.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

export default async function PricingPage({ searchParams }: { searchParams: Promise<{ page?: string; pageSize?: string; error?: string }> }) {
  const authState = await readAuthSessionState();
  const authRedirect = getAuthRequiredRedirect(authState);
  if (authRedirect) redirect(authRedirect);
  const session = authState.session;
  if (!session) throw new Error('Authenticated pricing guard returned without a session');
  const query = await searchParams;
  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) redirect('/dashboard?error=tenant');
  const organization = activeContext.organization;
  const authorization = await readOrganizationAuthorization({ organizationId: organization.id, userId: session.user.id });
  const canRead = Boolean(authorization?.platformAdmin || (authorization?.role && organizationRoleHasPermission(authorization.role, 'pricing:read')));
  if (!canRead) return <section className="sf-inventory-empty"><p className="sf-eyebrow">Pricing</p><h1>Pricing access is restricted</h1><p>Your organization role does not include pricing access.</p></section>;

  const pageSize = parseInventoryPageSize(query.pageSize);
  const properties = await listHospitalityProperties({ organizationId: organization.id, actorUserId: session.user.id, page: parseInventoryPage(query.page), pageSize });
  return <div className="sf-inventory-page">
    <header className="sf-inventory-page__header"><div><p className="sf-eyebrow">Commercial configuration</p><h1>Pricing</h1><p>Configure exact nightly base rates in {organization.currency}. Taxes, fees, and add-ons remain separate pricing layers.</p></div><span className="sf-inventory-count">{properties.total} properties</span></header>
    {query.error === 'tenant' ? <p className="sf-alert sf-alert--error" role="alert">Select an active organization before managing pricing.</p> : null}
    <section className="sf-inventory-card" aria-labelledby="pricing-properties-title"><div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Hospitality</p><h2 id="pricing-properties-title">Properties</h2></div><span>{properties.total} total</span></div>
      {properties.properties.length === 0 ? <div className="sf-empty-state"><h3>No properties yet</h3><p>Create hospitality inventory before configuring pricing.</p></div> : <ul className="sf-inventory-list">{properties.properties.map((property) => <li key={property.id}><Link className="sf-inventory-list__link" href={`/pricing/${property.id}`}><div><strong>{property.name}</strong><span>{property.code} · {property.countryCode}</span></div><div className="sf-inventory-list__meta"><span className={`sf-status-badge${property.status === 'ARCHIVED' ? ' sf-status-badge--muted' : ''}`}>{property.status.toLowerCase()}</span><span>Configure rates →</span></div></Link></li>)}</ul>}
      {properties.total > pageSize ? <nav className="sf-pagination" aria-label="Pricing property pages">{properties.page > 1 ? <Link className="sf-button sf-button--secondary sf-button--compact" href={`/pricing?page=${properties.page - 1}&pageSize=${pageSize}`}>Previous</Link> : <span />}<span>Page {properties.page} of {properties.totalPages}</span>{properties.page < properties.totalPages ? <Link className="sf-button sf-button--secondary sf-button--compact" href={`/pricing?page=${properties.page + 1}&pageSize=${pageSize}`}>Next</Link> : <span />}</nav> : null}
    </section>
  </div>;
}
