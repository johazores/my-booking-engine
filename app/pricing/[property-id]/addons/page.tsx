import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { organizationRoleHasPermission } from '@/server/authorization/authorization-domain.ts';
import { readOrganizationAuthorization } from '@/server/authorization/authorization-service.ts';
import { parseInventoryPage, parseInventoryPageSize } from '@/server/inventory/hospitality-domain.ts';
import { readHospitalityProperty } from '@/server/inventory/hospitality-service.ts';
import { listHospitalityAddons } from '@/server/pricing/hospitality-addon-service.ts';
import { listHospitalityPricingScopes } from '@/server/pricing/hospitality-pricing-scope-service.ts';
import { moneyMinorToMajorString } from '@/server/pricing/money.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

const errors: Record<string, string> = {
  permission: 'You do not have permission to manage pricing.',
  conflict: 'That add-on code overlaps another active add-on in an applicable scope.',
  unavailable: 'That property, pricing scope, or add-on is not available for active pricing.',
  validation: 'Check the add-on details and try again.',
  server: 'The pricing operation could not be completed. Try again.',
};
const statuses: Record<string, string> = {
  'addon-created': 'Add-on created.',
  'addon-archived': 'Add-on archived.',
};

function addonsHref(propertyId: string, input: { page?: number; scopePage?: number; pageSize: number }) {
  const params = new URLSearchParams();
  if ((input.page ?? 1) > 1) params.set('page', String(input.page));
  if ((input.scopePage ?? 1) > 1) params.set('scopePage', String(input.scopePage));
  if (input.pageSize !== 20) params.set('pageSize', String(input.pageSize));
  const suffix = params.toString();
  return suffix ? `/pricing/${propertyId}/addons?${suffix}` : `/pricing/${propertyId}/addons`;
}

function pricingLabel(model: string) {
  if (model === 'PER_ROOM') return 'per room';
  if (model === 'PER_ROOM_NIGHT') return 'per room night';
  if (model === 'PER_UNIT') return 'per selected unit';
  return 'per booking';
}

export default async function HospitalityAddonsPage({ params, searchParams }: {
  params: Promise<{ 'property-id': string }>;
  searchParams: Promise<{ page?: string; scopePage?: string; pageSize?: string; status?: string; error?: string }>;
}) {
  const authState = await readAuthSessionState();
  const authRedirect = getAuthRequiredRedirect(authState);
  if (authRedirect) redirect(authRedirect);
  const session = authState.session;
  if (!session) throw new Error('Authenticated pricing guard returned without a session');
  const routeParams = await params;
  const query = await searchParams;
  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) redirect('/pricing?error=tenant');
  const organization = activeContext.organization;
  const authorization = await readOrganizationAuthorization({ organizationId: organization.id, userId: session.user.id });
  const canRead = Boolean(authorization?.platformAdmin || (authorization?.role && organizationRoleHasPermission(authorization.role, 'pricing:read')));
  const canManage = Boolean(authorization?.platformAdmin || (authorization?.role && organizationRoleHasPermission(authorization.role, 'pricing:manage')));
  if (!canRead) return <section className="sf-inventory-empty"><p className="sf-eyebrow">Pricing</p><h1>Pricing access is restricted</h1><p>Your organization role does not include pricing access.</p></section>;

  const propertyId = routeParams['property-id'];
  const property = await readHospitalityProperty({ organizationId: organization.id, actorUserId: session.user.id, propertyId });
  if (!property) notFound();
  const pageSize = parseInventoryPageSize(query.pageSize);
  const [catalog, scopes] = await Promise.all([
    listHospitalityAddons({ organizationId: organization.id, actorUserId: session.user.id, propertyId, page: parseInventoryPage(query.page), pageSize }),
    listHospitalityPricingScopes({ organizationId: organization.id, actorUserId: session.user.id, propertyId, page: parseInventoryPage(query.scopePage), pageSize }),
  ]);
  const canMutate = canManage && property.status === 'ACTIVE';

  return <div className="sf-inventory-page">
    <header className="sf-inventory-page__header"><div><Link className="sf-back-link" href={`/pricing/${propertyId}`}>← Base pricing</Link><p className="sf-eyebrow">Hospitality pricing</p><h1>Add-ons</h1><p>{property.name} · optional selections priced in {organization.currency}.</p></div><div className="sf-page-actions"><Link className="sf-button sf-button--secondary sf-button--compact" href={`/pricing/${propertyId}/charges`}>Taxes & fees</Link><Link className="sf-button sf-button--secondary sf-button--compact" href={`/pricing/${propertyId}`}>Base rates</Link></div></header>
    {query.status && statuses[query.status] ? <p className="sf-alert sf-alert--success" role="status">{statuses[query.status]}</p> : null}
    {query.error && errors[query.error] ? <p className="sf-alert sf-alert--error" role="alert">{errors[query.error]}</p> : null}
    {property.status === 'ARCHIVED' ? <p className="sf-alert" role="status">This property is archived. Add-ons are read-only.</p> : null}

    <div className={`sf-inventory-layout${canMutate ? '' : ' sf-inventory-layout--single'}`}>
      <section className="sf-inventory-card" aria-labelledby="addons-title"><div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Optional products</p><h2 id="addons-title">Add-on catalog</h2></div><span>{catalog.total} add-ons</span></div>
        {catalog.addons.length === 0 ? <div className="sf-empty-state"><h3>No add-ons configured</h3><p>{canMutate ? 'Create a property-wide or sellable-scope add-on for customers to select during booking.' : 'No add-ons are configured for this property.'}</p></div> : <div className="sf-room-table-wrap"><table className="sf-room-table"><thead><tr><th scope="col">Add-on</th><th scope="col">Scope</th><th scope="col">Applicable stay dates</th><th scope="col">Price</th><th scope="col">Status</th>{canMutate ? <th scope="col">Action</th> : null}</tr></thead><tbody>{catalog.addons.map((addon) => <tr key={addon.id}><th scope="row">{addon.name}<br /><span>{addon.code}{addon.description ? ` · ${addon.description}` : ''}</span></th><td>{addon.roomType && addon.ratePlan ? `${addon.roomType.name} · ${addon.ratePlan.name}` : 'Entire property'}</td><td>{addon.startDate.toISOString().slice(0, 10)} → {addon.endDate.toISOString().slice(0, 10)}</td><td>{addon.currency} {moneyMinorToMajorString(addon.amountMinor, addon.currency)} {pricingLabel(addon.pricingModel)}{addon.pricingModel === 'PER_UNIT' ? ` · max ${addon.maxQuantity}` : ''}</td><td><span className={`sf-status-badge${addon.status === 'ARCHIVED' ? ' sf-status-badge--muted' : ''}`}>{addon.status.toLowerCase()}</span></td>{canMutate ? <td>{addon.status === 'ACTIVE' ? <form action={`/api/pricing/addons/${addon.id}/archive`} method="post"><input type="hidden" name="propertyId" value={propertyId} /><button className="sf-button sf-button--danger sf-button--compact" type="submit">Archive</button></form> : '—'}</td> : null}</tr>)}</tbody></table></div>}
        {catalog.total > pageSize ? <nav className="sf-pagination" aria-label="Add-on catalog pages">{catalog.page > 1 ? <Link className="sf-button sf-button--secondary sf-button--compact" href={addonsHref(propertyId, { page: catalog.page - 1, scopePage: scopes.page, pageSize })}>Previous</Link> : <span />}<span>Page {catalog.page} of {catalog.totalPages}</span>{catalog.page < catalog.totalPages ? <Link className="sf-button sf-button--secondary sf-button--compact" href={addonsHref(propertyId, { page: catalog.page + 1, scopePage: scopes.page, pageSize })}>Next</Link> : <span />}</nav> : null}
      </section>

      {canMutate ? <aside className="sf-inventory-card sf-inventory-card--create"><p className="sf-eyebrow">New add-on</p><h2>Add optional product</h2><p>Add-ons are selected explicitly during quoting. Their date window must cover every occupied night. Non-unit models always use one selection and derive their multiplier from the stay.</p><form className="sf-form" action="/api/pricing/addons" method="post"><input type="hidden" name="propertyId" value={propertyId} /><label className="sf-field">Name<input name="name" maxLength={120} required /></label><label className="sf-field">Code<input name="code" maxLength={32} required /></label><label className="sf-field">Description<textarea name="description" maxLength={300} rows={3} /></label><label className="sf-field">Scope<select name="scope" defaultValue=""><option value="">Entire property</option>{scopes.scopes.map((scope) => <option key={`${scope.roomTypeId}:${scope.ratePlanId}`} value={`${scope.roomTypeId}|${scope.ratePlanId}`}>{scope.roomType.name} · {scope.ratePlan.name}</option>)}</select></label>{scopes.total > pageSize ? <nav className="sf-pagination" aria-label="Sellable add-on scope pages">{scopes.page > 1 ? <Link className="sf-button sf-button--secondary sf-button--compact" href={addonsHref(propertyId, { page: catalog.page, scopePage: scopes.page - 1, pageSize })}>Previous scopes</Link> : <span />}<span>Scope page {scopes.page} of {scopes.totalPages}</span>{scopes.page < scopes.totalPages ? <Link className="sf-button sf-button--secondary sf-button--compact" href={addonsHref(propertyId, { page: catalog.page, scopePage: scopes.page + 1, pageSize })}>Next scopes</Link> : <span />}</nav> : null}<div className="sf-form-row"><label className="sf-field">Pricing model<select name="pricingModel" required defaultValue="PER_BOOKING"><option value="PER_BOOKING">Per booking</option><option value="PER_ROOM">Per room</option><option value="PER_ROOM_NIGHT">Per room night</option><option value="PER_UNIT">Per selected unit</option></select></label><label className="sf-field">Amount ({organization.currency})<input name="amount" inputMode="decimal" placeholder="250.00" required /></label></div><label className="sf-field">Maximum selected quantity<input name="maxQuantity" type="number" min="1" max="100" defaultValue="1" required /><span>Keep this at 1 unless the pricing model is per selected unit.</span></label><div className="sf-form-row"><label className="sf-field">Applies from<input type="date" name="startDate" required /></label><label className="sf-field">Applies through<input type="date" name="endDate" required /></label></div><button className="sf-button sf-button--primary" type="submit">Add add-on</button></form></aside> : null}
    </div>
  </div>;
}
