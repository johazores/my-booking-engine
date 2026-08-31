import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { organizationRoleHasPermission } from '@/server/authorization/authorization-domain.ts';
import { readOrganizationAuthorization } from '@/server/authorization/authorization-service.ts';
import { parseInventoryPage, parseInventoryPageSize } from '@/server/inventory/hospitality-domain.ts';
import { readHospitalityProperty } from '@/server/inventory/hospitality-service.ts';
import { listHospitalityBaseRates } from '@/server/pricing/hospitality-pricing-service.ts';
import { listHospitalityPricingScopes } from '@/server/pricing/hospitality-pricing-scope-service.ts';
import { moneyMinorToMajorString } from '@/server/pricing/money.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

const errors: Record<string, string> = {
  permission: 'You do not have permission to manage pricing.',
  conflict: 'That date range overlaps an active base rate for this room type and rate plan.',
  unavailable: 'That pricing scope or base rate is not available for active inventory.',
  validation: 'Check the dates and amount and try again.',
  server: 'The pricing operation could not be completed. Try again.',
};

const statuses: Record<string, string> = {
  'base-rate-created': 'Base rate created.',
  'base-rate-archived': 'Base rate archived.',
};

function pricingHref(propertyId: string, input: { roomTypeId?: string; ratePlanId?: string; scopePage?: number; ratePage?: number; pageSize: number }) {
  const query = new URLSearchParams();
  if (input.roomTypeId) query.set('roomType', input.roomTypeId);
  if (input.ratePlanId) query.set('ratePlan', input.ratePlanId);
  if ((input.scopePage ?? 1) > 1) query.set('scopePage', String(input.scopePage));
  if ((input.ratePage ?? 1) > 1) query.set('ratePage', String(input.ratePage));
  if (input.pageSize !== 20) query.set('pageSize', String(input.pageSize));
  const suffix = query.toString();
  return suffix ? `/pricing/${propertyId}?${suffix}` : `/pricing/${propertyId}`;
}

export default async function PropertyPricingPage({ params, searchParams }: {
  params: Promise<{ 'property-id': string }>;
  searchParams: Promise<{ roomType?: string; ratePlan?: string; scopePage?: string; ratePage?: string; pageSize?: string; status?: string; error?: string }>;
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
  const scopes = await listHospitalityPricingScopes({ organizationId: organization.id, actorUserId: session.user.id, propertyId, page: parseInventoryPage(query.scopePage), pageSize });
  const selectedScope = scopes.scopes.find((scope) => scope.roomTypeId === query.roomType && scope.ratePlanId === query.ratePlan) ?? scopes.scopes[0] ?? null;
  const rates = selectedScope ? await listHospitalityBaseRates({ organizationId: organization.id, actorUserId: session.user.id, propertyId, roomTypeId: selectedScope.roomTypeId, ratePlanId: selectedScope.ratePlanId, page: parseInventoryPage(query.ratePage), pageSize }) : null;
  const canMutate = canManage && property.status === 'ACTIVE' && Boolean(selectedScope);

  return <div className="sf-inventory-page">
    <header className="sf-inventory-page__header"><div><Link className="sf-back-link" href="/pricing">← Pricing</Link><p className="sf-eyebrow">Hospitality pricing</p><h1>{property.name}</h1><p>Nightly base rates use exact {organization.currency} minor-unit storage. Overlapping active windows are not allowed.</p></div><div className="sf-image-scope__nav"><Link className="sf-button sf-button--secondary sf-button--compact" href={`/inventory/${propertyId}/rate-plans`}>Rate plans</Link><Link className="sf-button sf-button--secondary sf-button--compact" href={`/inventory/${propertyId}/restrictions`}>Restrictions</Link></div></header>
    {query.status && statuses[query.status] ? <p className="sf-alert sf-alert--success" role="status">{statuses[query.status]}</p> : null}
    {query.error && errors[query.error] ? <p className="sf-alert sf-alert--error" role="alert">{errors[query.error]}</p> : null}
    {property.status === 'ARCHIVED' ? <p className="sf-alert" role="status">This property is archived. Pricing is read-only.</p> : null}

    <section className="sf-inventory-card" aria-labelledby="pricing-scopes-title"><div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Sellable scopes</p><h2 id="pricing-scopes-title">Room type + rate plan</h2></div><span>{scopes.total} assignments</span></div>
      {scopes.scopes.length === 0 ? <div className="sf-empty-state"><h3>No sellable pricing scopes</h3><p>Assign an active rate plan to an active room type before configuring base rates.</p><Link className="sf-button sf-button--primary" href={`/inventory/${propertyId}/rate-plans`}>Manage rate plans</Link></div> : <ul className="sf-inventory-list">{scopes.scopes.map((scope) => <li key={`${scope.roomTypeId}:${scope.ratePlanId}`}><Link className={`sf-inventory-list__link${selectedScope?.roomTypeId === scope.roomTypeId && selectedScope?.ratePlanId === scope.ratePlanId ? ' sf-inventory-list__link--selected' : ''}`} href={pricingHref(propertyId, { roomTypeId: scope.roomTypeId, ratePlanId: scope.ratePlanId, scopePage: scopes.page, pageSize })}><div><strong>{scope.roomType.name}</strong><span>{scope.roomType.code} · {scope.ratePlan.name} ({scope.ratePlan.code})</span></div><span>Configure →</span></Link></li>)}</ul>}
      {scopes.total > pageSize ? <nav className="sf-pagination" aria-label="Pricing scope pages">{scopes.page > 1 ? <Link className="sf-button sf-button--secondary sf-button--compact" href={pricingHref(propertyId, { scopePage: scopes.page - 1, pageSize })}>Previous</Link> : <span />}<span>Page {scopes.page} of {scopes.totalPages}</span>{scopes.page < scopes.totalPages ? <Link className="sf-button sf-button--secondary sf-button--compact" href={pricingHref(propertyId, { scopePage: scopes.page + 1, pageSize })}>Next</Link> : <span />}</nav> : null}
    </section>

    {selectedScope && rates ? <div className={`sf-inventory-layout${canMutate ? '' : ' sf-inventory-layout--single'}`}>
      <section className="sf-inventory-card" aria-labelledby="base-rates-title"><div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">{selectedScope.ratePlan.name}</p><h2 id="base-rates-title">{selectedScope.roomType.name} base rates</h2></div><span>{rates.total} windows</span></div>
        {rates.baseRates.length === 0 ? <div className="sf-empty-state"><h3>No base rates yet</h3><p>{canMutate ? 'Add a date window before this scope can produce a price quote.' : 'No base rates are configured for this scope.'}</p></div> : <div className="sf-room-table-wrap"><table className="sf-room-table"><thead><tr><th scope="col">Dates</th><th scope="col">Nightly rate</th><th scope="col">Status</th>{canMutate ? <th scope="col">Action</th> : null}</tr></thead><tbody>{rates.baseRates.map((rate) => <tr key={rate.id}><th scope="row">{rate.startDate.toISOString().slice(0, 10)} → {rate.endDate.toISOString().slice(0, 10)}</th><td>{rate.currency} {moneyMinorToMajorString(rate.amountMinor, rate.currency)}</td><td><span className={`sf-status-badge${rate.status === 'ARCHIVED' ? ' sf-status-badge--muted' : ''}`}>{rate.status.toLowerCase()}</span></td>{canMutate ? <td>{rate.status === 'ACTIVE' ? <form action={`/api/pricing/base-rates/${rate.id}/archive`} method="post"><input type="hidden" name="propertyId" value={propertyId} /><input type="hidden" name="roomTypeId" value={selectedScope.roomTypeId} /><input type="hidden" name="ratePlanId" value={selectedScope.ratePlanId} /><button className="sf-button sf-button--danger sf-button--compact" type="submit">Archive</button></form> : '—'}</td> : null}</tr>)}</tbody></table></div>}
        {rates.total > pageSize ? <nav className="sf-pagination" aria-label="Base rate pages">{rates.page > 1 ? <Link className="sf-button sf-button--secondary sf-button--compact" href={pricingHref(propertyId, { roomTypeId: selectedScope.roomTypeId, ratePlanId: selectedScope.ratePlanId, scopePage: scopes.page, ratePage: rates.page - 1, pageSize })}>Previous</Link> : <span />}<span>Page {rates.page} of {rates.totalPages}</span>{rates.page < rates.totalPages ? <Link className="sf-button sf-button--secondary sf-button--compact" href={pricingHref(propertyId, { roomTypeId: selectedScope.roomTypeId, ratePlanId: selectedScope.ratePlanId, scopePage: scopes.page, ratePage: rates.page + 1, pageSize })}>Next</Link> : <span />}</nav> : null}
      </section>
      {canMutate ? <aside className="sf-inventory-card sf-inventory-card--create"><p className="sf-eyebrow">New base rate</p><h2>Add nightly price</h2><p>Amounts are stored as integer minor units; the form follows {organization.currency} decimal rules.</p><form className="sf-form" action="/api/pricing/base-rates" method="post"><input type="hidden" name="propertyId" value={propertyId} /><input type="hidden" name="roomTypeId" value={selectedScope.roomTypeId} /><input type="hidden" name="ratePlanId" value={selectedScope.ratePlanId} /><label className="sf-field">Start date<input type="date" name="startDate" required /></label><label className="sf-field">End date<input type="date" name="endDate" required /></label><label className="sf-field">Nightly amount ({organization.currency})<input name="amount" inputMode="decimal" placeholder="1500.00" required /></label><button className="sf-button sf-button--primary" type="submit">Add base rate</button></form></aside> : null}
    </div> : null}
  </div>;
}
