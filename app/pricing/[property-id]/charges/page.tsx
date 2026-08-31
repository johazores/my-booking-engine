import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { organizationRoleHasPermission } from '@/server/authorization/authorization-domain.ts';
import { readOrganizationAuthorization } from '@/server/authorization/authorization-service.ts';
import { parseInventoryPage, parseInventoryPageSize } from '@/server/inventory/hospitality-domain.ts';
import { readHospitalityProperty } from '@/server/inventory/hospitality-service.ts';
import { listHospitalityChargeRules } from '@/server/pricing/hospitality-charge-service.ts';
import { listHospitalityPricingScopes } from '@/server/pricing/hospitality-pricing-scope-service.ts';
import { moneyMinorToMajorString } from '@/server/pricing/money.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

const errors: Record<string, string> = {
  permission: 'You do not have permission to manage pricing.',
  conflict: 'That charge code overlaps another active charge in an applicable scope.',
  unavailable: 'That property or pricing scope is not available for active pricing.',
  validation: 'Check the charge details and try again.',
  server: 'The pricing operation could not be completed. Try again.',
};
const statuses: Record<string, string> = {
  'charge-created': 'Tax or fee rule created.',
  'charge-archived': 'Tax or fee rule archived.',
};

function ruleValue(rule: { calculation: string; percentageBps: number | null; amountMinor: bigint | null; currency: string | null }) {
  if (rule.calculation === 'PERCENTAGE') return `${((rule.percentageBps ?? 0) / 100).toFixed(2)}%`;
  if (rule.amountMinor === null || !rule.currency) return 'Invalid fixed amount';
  return `${rule.currency} ${moneyMinorToMajorString(rule.amountMinor, rule.currency)} ${rule.calculation === 'FIXED_PER_BOOKING' ? 'per booking' : 'per room night'}`;
}

function chargesHref(propertyId: string, input: { page?: number; scopePage?: number; pageSize: number }) {
  const params = new URLSearchParams();
  if ((input.page ?? 1) > 1) params.set('page', String(input.page));
  if ((input.scopePage ?? 1) > 1) params.set('scopePage', String(input.scopePage));
  if (input.pageSize !== 20) params.set('pageSize', String(input.pageSize));
  const suffix = params.toString();
  return suffix ? `/pricing/${propertyId}/charges?${suffix}` : `/pricing/${propertyId}/charges`;
}

export default async function HospitalityChargesPage({ params, searchParams }: {
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
  const [rules, scopes] = await Promise.all([
    listHospitalityChargeRules({ organizationId: organization.id, actorUserId: session.user.id, propertyId, page: parseInventoryPage(query.page), pageSize }),
    listHospitalityPricingScopes({ organizationId: organization.id, actorUserId: session.user.id, propertyId, page: parseInventoryPage(query.scopePage), pageSize }),
  ]);
  const canMutate = canManage && property.status === 'ACTIVE';

  return <div className="sf-inventory-page">
    <header className="sf-inventory-page__header"><div><Link className="sf-back-link" href={`/pricing/${propertyId}`}>← Base pricing</Link><p className="sf-eyebrow">Hospitality pricing</p><h1>Taxes & fees</h1><p>{property.name} · exact {organization.currency} fixed amounts or basis-point percentages.</p></div><Link className="sf-button sf-button--secondary sf-button--compact" href={`/pricing/${propertyId}`}>Base rates</Link></header>
    {query.status && statuses[query.status] ? <p className="sf-alert sf-alert--success" role="status">{statuses[query.status]}</p> : null}
    {query.error && errors[query.error] ? <p className="sf-alert sf-alert--error" role="alert">{errors[query.error]}</p> : null}
    {property.status === 'ARCHIVED' ? <p className="sf-alert" role="status">This property is archived. Taxes and fees are read-only.</p> : null}

    <div className={`sf-inventory-layout${canMutate ? '' : ' sf-inventory-layout--single'}`}>
      <section className="sf-inventory-card" aria-labelledby="charge-rules-title"><div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Commercial adjustments</p><h2 id="charge-rules-title">Configured taxes & fees</h2></div><span>{rules.total} rules</span></div>
        {rules.rules.length === 0 ? <div className="sf-empty-state"><h3>No taxes or fees configured</h3><p>{canMutate ? 'Create a property-wide or sellable-scope rule to include it in price quotes.' : 'No tax or fee rules are configured for this property.'}</p></div> : <div className="sf-room-table-wrap"><table className="sf-room-table"><thead><tr><th scope="col">Rule</th><th scope="col">Scope</th><th scope="col">Dates</th><th scope="col">Value</th><th scope="col">Status</th>{canMutate ? <th scope="col">Action</th> : null}</tr></thead><tbody>{rules.rules.map((rule) => <tr key={rule.id}><th scope="row">{rule.name}<br /><span>{rule.code} · {rule.kind.toLowerCase()}</span></th><td>{rule.roomType && rule.ratePlan ? `${rule.roomType.name} · ${rule.ratePlan.name}` : 'Entire property'}</td><td>{rule.startDate.toISOString().slice(0, 10)} → {rule.endDate.toISOString().slice(0, 10)}</td><td>{ruleValue(rule)}</td><td><span className={`sf-status-badge${rule.status === 'ARCHIVED' ? ' sf-status-badge--muted' : ''}`}>{rule.status.toLowerCase()}</span></td>{canMutate ? <td>{rule.status === 'ACTIVE' ? <form action={`/api/pricing/charges/${rule.id}/archive`} method="post"><input type="hidden" name="propertyId" value={propertyId} /><button className="sf-button sf-button--danger sf-button--compact" type="submit">Archive</button></form> : '—'}</td> : null}</tr>)}</tbody></table></div>}
        {rules.total > pageSize ? <nav className="sf-pagination" aria-label="Tax and fee rule pages">{rules.page > 1 ? <Link className="sf-button sf-button--secondary sf-button--compact" href={chargesHref(propertyId, { page: rules.page - 1, scopePage: scopes.page, pageSize })}>Previous</Link> : <span />}<span>Page {rules.page} of {rules.totalPages}</span>{rules.page < rules.totalPages ? <Link className="sf-button sf-button--secondary sf-button--compact" href={chargesHref(propertyId, { page: rules.page + 1, scopePage: scopes.page, pageSize })}>Next</Link> : <span />}</nav> : null}
      </section>

      {canMutate ? <aside className="sf-inventory-card sf-inventory-card--create"><p className="sf-eyebrow">New rule</p><h2>Add tax or fee</h2><p>Percentage rules apply to eligible accommodation subtotal. Fixed room-night fees multiply by occupied nights and room quantity; fixed booking fees apply once.</p><form className="sf-form" action="/api/pricing/charges" method="post"><input type="hidden" name="propertyId" value={propertyId} /><label className="sf-field">Name<input name="name" maxLength={120} required /></label><label className="sf-field">Code<input name="code" maxLength={32} required /></label><div className="sf-form-row"><label className="sf-field">Kind<select name="kind" required defaultValue="TAX"><option value="TAX">Tax</option><option value="FEE">Fee</option></select></label><label className="sf-field">Calculation<select name="calculation" required defaultValue="PERCENTAGE"><option value="PERCENTAGE">Percentage</option><option value="FIXED_PER_BOOKING">Fixed per booking</option><option value="FIXED_PER_ROOM_NIGHT">Fixed per room night</option></select></label></div><label className="sf-field">Scope<select name="scope" defaultValue=""><option value="">Entire property</option>{scopes.scopes.map((scope) => <option key={`${scope.roomTypeId}:${scope.ratePlanId}`} value={`${scope.roomTypeId}|${scope.ratePlanId}`}>{scope.roomType.name} · {scope.ratePlan.name}</option>)}</select></label>{scopes.total > pageSize ? <nav className="sf-pagination" aria-label="Sellable charge scope pages">{scopes.page > 1 ? <Link className="sf-button sf-button--secondary sf-button--compact" href={chargesHref(propertyId, { page: rules.page, scopePage: scopes.page - 1, pageSize })}>Previous scopes</Link> : <span />}<span>Scope page {scopes.page} of {scopes.totalPages}</span>{scopes.page < scopes.totalPages ? <Link className="sf-button sf-button--secondary sf-button--compact" href={chargesHref(propertyId, { page: rules.page, scopePage: scopes.page + 1, pageSize })}>Next scopes</Link> : <span />}</nav> : null}<label className="sf-field">Value<input name="value" inputMode="decimal" placeholder="12.00 for 12% or 250.00 fixed" required /></label><div className="sf-form-row"><label className="sf-field">Start date<input type="date" name="startDate" required /></label><label className="sf-field">End date<input type="date" name="endDate" required /></label></div><button className="sf-button sf-button--primary" type="submit">Add tax or fee</button></form></aside> : null}
    </div>
  </div>;
}
