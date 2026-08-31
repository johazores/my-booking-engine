import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { organizationRoleHasPermission } from '@/server/authorization/authorization-domain.ts';
import { readOrganizationAuthorization } from '@/server/authorization/authorization-service.ts';
import { parseInventoryPage, parseInventoryPageSize } from '@/server/inventory/hospitality-domain.ts';
import { listHospitalityRatePlans, readHospitalityRatePlan } from '@/server/inventory/hospitality-rate-plan-service.ts';
import { formatRestrictionDate } from '@/server/inventory/hospitality-restriction-domain.ts';
import {
  listHospitalityRestrictions,
  listHospitalityRestrictionRoomTypeScopes,
  readHospitalityRestrictionRoomTypeScope,
} from '@/server/inventory/hospitality-restriction-service.ts';
import { readHospitalityProperty } from '@/server/inventory/hospitality-service.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

const errors: Record<string, string> = {
  permission: 'You do not have permission to manage restrictions.',
  conflict: 'An active restriction already overlaps this scope and date range.',
  dependency: 'Archive dependent restrictions before changing this inventory relationship.',
  unavailable: 'That rate plan, room type, or restriction is not available for this property.',
  validation: 'Check the restriction dates and controls and try again.',
  server: 'The restriction operation could not be completed. Try again.',
};

const statuses: Record<string, string> = {
  'restriction-created': 'Restriction created.',
  'restriction-archived': 'Restriction archived.',
};

function restrictionHref(propertyId: string, input: {
  ratePlanId?: string;
  roomTypeId?: string;
  planPage?: number;
  scopePage?: number;
  restrictionPage?: number;
  pageSize: number;
}) {
  const params = new URLSearchParams();
  if (input.ratePlanId) params.set('ratePlan', input.ratePlanId);
  if (input.roomTypeId) params.set('roomType', input.roomTypeId);
  if ((input.planPage ?? 1) > 1) params.set('planPage', String(input.planPage));
  if ((input.scopePage ?? 1) > 1) params.set('scopePage', String(input.scopePage));
  if ((input.restrictionPage ?? 1) > 1) params.set('restrictionPage', String(input.restrictionPage));
  if (input.pageSize !== 20) params.set('pageSize', String(input.pageSize));
  const query = params.toString();
  return query ? `/inventory/${propertyId}/restrictions?${query}` : `/inventory/${propertyId}/restrictions`;
}

function restrictionSummary(restriction: {
  minStayNights: number | null;
  maxStayNights: number | null;
  closedToArrival: boolean;
  closedToDeparture: boolean;
}) {
  const parts: string[] = [];
  if (restriction.minStayNights !== null) parts.push(`min ${restriction.minStayNights} night${restriction.minStayNights === 1 ? '' : 's'}`);
  if (restriction.maxStayNights !== null) parts.push(`max ${restriction.maxStayNights} night${restriction.maxStayNights === 1 ? '' : 's'}`);
  if (restriction.closedToArrival) parts.push('closed to arrival');
  if (restriction.closedToDeparture) parts.push('closed to departure');
  return parts.join(' · ');
}

export default async function HospitalityRestrictionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ 'property-id': string }>;
  searchParams: Promise<{
    ratePlan?: string;
    roomType?: string;
    planPage?: string;
    scopePage?: string;
    restrictionPage?: string;
    pageSize?: string;
    status?: string;
    error?: string;
  }>;
}) {
  const authState = await readAuthSessionState();
  const authRedirect = getAuthRequiredRedirect(authState);
  if (authRedirect) redirect(authRedirect);
  const session = authState.session;
  if (!session) throw new Error('Authenticated restriction guard returned without a session');

  const routeParams = await params;
  const query = await searchParams;
  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) redirect('/inventory?error=tenant');
  const organization = activeContext.organization;
  const authorization = await readOrganizationAuthorization({ organizationId: organization.id, userId: session.user.id });
  const canRead = Boolean(authorization?.platformAdmin || (authorization?.role && organizationRoleHasPermission(authorization.role, 'inventory:read')));
  const canManage = Boolean(authorization?.platformAdmin || (authorization?.role && organizationRoleHasPermission(authorization.role, 'inventory:manage')));
  if (!canRead) return <section className="sf-inventory-empty"><p className="sf-eyebrow">Inventory</p><h1>Restriction access is restricted</h1><p>Your organization role does not include inventory access.</p></section>;

  const propertyId = routeParams['property-id'];
  const property = await readHospitalityProperty({ organizationId: organization.id, actorUserId: session.user.id, propertyId });
  if (!property) notFound();

  const pageSize = parseInventoryPageSize(query.pageSize);
  const ratePlans = await listHospitalityRatePlans({
    organizationId: organization.id,
    actorUserId: session.user.id,
    propertyId,
    page: parseInventoryPage(query.planPage),
    pageSize,
  });
  const requestedRatePlan = query.ratePlan ? await readHospitalityRatePlan({
    organizationId: organization.id,
    actorUserId: session.user.id,
    propertyId,
    ratePlanId: query.ratePlan,
  }) : null;
  const selectedRatePlan = requestedRatePlan ?? ratePlans.ratePlans.find((item) => item.status === 'ACTIVE') ?? ratePlans.ratePlans[0] ?? null;

  const scopes = selectedRatePlan ? await listHospitalityRestrictionRoomTypeScopes({
    organizationId: organization.id,
    actorUserId: session.user.id,
    propertyId,
    ratePlanId: selectedRatePlan.id,
    page: parseInventoryPage(query.scopePage),
    pageSize,
  }) : null;
  const requestedRoomType = selectedRatePlan && query.roomType ? await readHospitalityRestrictionRoomTypeScope({
    organizationId: organization.id,
    actorUserId: session.user.id,
    propertyId,
    ratePlanId: selectedRatePlan.id,
    roomTypeId: query.roomType,
  }) : null;
  const selectedRoomType = requestedRoomType ?? null;
  const restrictions = selectedRatePlan ? await listHospitalityRestrictions({
    organizationId: organization.id,
    actorUserId: session.user.id,
    propertyId,
    ratePlanId: selectedRatePlan.id,
    roomTypeId: selectedRoomType?.id ?? null,
    page: parseInventoryPage(query.restrictionPage),
    pageSize,
  }) : null;

  const canMutateProperty = canManage && property.status === 'ACTIVE';
  const canMutateScope = Boolean(canMutateProperty && selectedRatePlan?.status === 'ACTIVE' && (!selectedRoomType || selectedRoomType.status === 'ACTIVE'));

  return <div className="sf-inventory-page">
    <header className="sf-inventory-page__header">
      <div>
        <Link className="sf-back-link" href={`/inventory/${propertyId}`}>← {property.name}</Link>
        <p className="sf-eyebrow">Hospitality inventory</p>
        <h1>Restrictions</h1>
        <p>Configure stay and arrival/departure rules by rate plan and optional room-type scope. Pricing and inventory counts remain separate.</p>
      </div>
      <div className="sf-image-scope__nav">
        <Link className="sf-button sf-button--secondary sf-button--compact" href={`/inventory/${propertyId}/rate-plans`}>Rate plans</Link>
        <Link className="sf-button sf-button--secondary sf-button--compact" href={`/inventory/${propertyId}/images`}>Images</Link>
      </div>
    </header>

    {query.status && statuses[query.status] ? <p className="sf-alert sf-alert--success" role="status">{statuses[query.status]}</p> : null}
    {query.error && errors[query.error] ? <p className="sf-alert sf-alert--error" role="alert">{errors[query.error]}</p> : null}
    {property.status === 'ARCHIVED' ? <p className="sf-alert" role="status">This property is archived. Restriction configuration is read-only.</p> : null}

    <section className="sf-inventory-card" aria-labelledby="restriction-plans-title">
      <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Commercial scope</p><h2 id="restriction-plans-title">Rate plan</h2></div><span>{ratePlans.total} plans</span></div>
      {ratePlans.ratePlans.length === 0 ? <div className="sf-empty-state"><h3>No rate plans yet</h3><p>Create and assign rate plans before adding restrictions.</p><Link className="sf-button sf-button--primary" href={`/inventory/${propertyId}/rate-plans`}>Manage rate plans</Link></div> : <ul className="sf-inventory-list">{ratePlans.ratePlans.map((ratePlan) => <li key={ratePlan.id}><Link className={`sf-inventory-list__link${selectedRatePlan?.id === ratePlan.id ? ' sf-inventory-list__link--selected' : ''}`} href={restrictionHref(propertyId, { ratePlanId: ratePlan.id, planPage: ratePlans.page, pageSize })}><div><strong>{ratePlan.name}</strong><span>{ratePlan.code}</span></div><div className="sf-inventory-list__meta"><span className={`sf-status-badge${ratePlan.status === 'ARCHIVED' ? ' sf-status-badge--muted' : ''}`}>{ratePlan.status.toLowerCase()}</span><span>{ratePlan._count.restrictions} rules</span></div></Link></li>)}</ul>}
      {ratePlans.total > pageSize ? <nav className="sf-pagination" aria-label="Restriction rate plan pages">{ratePlans.page > 1 ? <Link className="sf-button sf-button--secondary sf-button--compact" href={restrictionHref(propertyId, { ratePlanId: selectedRatePlan?.id, planPage: ratePlans.page - 1, pageSize })}>Previous</Link> : <span />}<span>Page {ratePlans.page} of {ratePlans.totalPages}</span>{ratePlans.page < ratePlans.totalPages ? <Link className="sf-button sf-button--secondary sf-button--compact" href={restrictionHref(propertyId, { ratePlanId: selectedRatePlan?.id, planPage: ratePlans.page + 1, pageSize })}>Next</Link> : <span />}</nav> : null}
    </section>

    {selectedRatePlan && scopes && restrictions ? <>
      <section className="sf-inventory-card" aria-labelledby="restriction-scopes-title">
        <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Rule scope</p><h2 id="restriction-scopes-title">{selectedRatePlan.name}</h2><p>Property-wide rules apply to every room type using this rate plan. Room-type rules narrow the scope.</p></div><span>{scopes.total} assigned room types</span></div>
        <ul className="sf-inventory-list">
          <li><Link className={`sf-inventory-list__link${selectedRoomType ? '' : ' sf-inventory-list__link--selected'}`} href={restrictionHref(propertyId, { ratePlanId: selectedRatePlan.id, planPage: ratePlans.page, scopePage: scopes.page, pageSize })}><div><strong>All assigned room types</strong><span>Property-wide rate-plan scope</span></div><span>Default</span></Link></li>
          {scopes.assignments.map((assignment) => <li key={assignment.roomTypeId}><Link className={`sf-inventory-list__link${selectedRoomType?.id === assignment.roomTypeId ? ' sf-inventory-list__link--selected' : ''}`} href={restrictionHref(propertyId, { ratePlanId: selectedRatePlan.id, roomTypeId: assignment.roomTypeId, planPage: ratePlans.page, scopePage: scopes.page, pageSize })}><div><strong>{assignment.roomType.name}</strong><span>{assignment.roomType.code}</span></div><span className={`sf-status-badge${assignment.roomType.status === 'ARCHIVED' ? ' sf-status-badge--muted' : ''}`}>{assignment.roomType.status.toLowerCase()}</span></Link></li>)}
        </ul>
        {scopes.total > pageSize ? <nav className="sf-pagination" aria-label="Restriction room type scopes">{scopes.page > 1 ? <Link className="sf-button sf-button--secondary sf-button--compact" href={restrictionHref(propertyId, { ratePlanId: selectedRatePlan.id, roomTypeId: selectedRoomType?.id, planPage: ratePlans.page, scopePage: scopes.page - 1, pageSize })}>Previous</Link> : <span />}<span>Page {scopes.page} of {scopes.totalPages}</span>{scopes.page < scopes.totalPages ? <Link className="sf-button sf-button--secondary sf-button--compact" href={restrictionHref(propertyId, { ratePlanId: selectedRatePlan.id, roomTypeId: selectedRoomType?.id, planPage: ratePlans.page, scopePage: scopes.page + 1, pageSize })}>Next</Link> : <span />}</nav> : null}
      </section>

      <div className={`sf-inventory-layout${canMutateScope ? '' : ' sf-inventory-layout--single'}`}>
        <section className="sf-inventory-card" aria-labelledby="restriction-rules-title">
          <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Date windows</p><h2 id="restriction-rules-title">{selectedRoomType ? selectedRoomType.name : 'All assigned room types'}</h2></div><span>{restrictions.total} rules</span></div>
          {restrictions.restrictions.length === 0 ? <div className="sf-empty-state"><h3>No restrictions in this scope</h3><p>{canMutateScope ? 'Add a date window when this rate plan needs stay or arrival/departure controls.' : 'No restriction history exists for this scope.'}</p></div> : <div className="sf-room-table-wrap"><table className="sf-room-table"><thead><tr><th scope="col">Dates</th><th scope="col">Rule</th><th scope="col">Status</th>{canMutateScope ? <th scope="col">Action</th> : null}</tr></thead><tbody>{restrictions.restrictions.map((restriction) => <tr key={restriction.id}><th scope="row">{formatRestrictionDate(restriction.startDate)} → {formatRestrictionDate(restriction.endDate)}</th><td>{restrictionSummary(restriction)}</td><td><span className={`sf-status-badge${restriction.status === 'ARCHIVED' ? ' sf-status-badge--muted' : ''}`}>{restriction.status.toLowerCase()}</span></td>{canMutateScope ? <td>{restriction.status === 'ACTIVE' ? <form className="sf-archive-inline" action={`/api/inventory/restrictions/${restriction.id}/archive`} method="post"><input type="hidden" name="propertyId" value={propertyId} /><input type="hidden" name="ratePlanId" value={selectedRatePlan.id} /><input type="hidden" name="roomTypeId" value={selectedRoomType?.id ?? ''} /><input className="sf-archive-inline__input" name="confirmation" aria-label={`Type ARCHIVE to archive restriction starting ${formatRestrictionDate(restriction.startDate)}`} placeholder="ARCHIVE" required /><button className="sf-button sf-button--danger sf-button--compact" type="submit">Archive</button></form> : '—'}</td> : null}</tr>)}</tbody></table></div>}
          {restrictions.total > pageSize ? <nav className="sf-pagination" aria-label="Restriction pages">{restrictions.page > 1 ? <Link className="sf-button sf-button--secondary sf-button--compact" href={restrictionHref(propertyId, { ratePlanId: selectedRatePlan.id, roomTypeId: selectedRoomType?.id, planPage: ratePlans.page, scopePage: scopes.page, restrictionPage: restrictions.page - 1, pageSize })}>Previous</Link> : <span />}<span>Page {restrictions.page} of {restrictions.totalPages}</span>{restrictions.page < restrictions.totalPages ? <Link className="sf-button sf-button--secondary sf-button--compact" href={restrictionHref(propertyId, { ratePlanId: selectedRatePlan.id, roomTypeId: selectedRoomType?.id, planPage: ratePlans.page, scopePage: scopes.page, restrictionPage: restrictions.page + 1, pageSize })}>Next</Link> : <span />}</nav> : null}
        </section>

        {canMutateScope ? <aside className="sf-inventory-card sf-inventory-card--create"><p className="sf-eyebrow">New restriction</p><h2>Add date window</h2><p>Overlapping active windows are rejected within the same scope to keep rule evaluation deterministic.</p><form className="sf-form" action="/api/inventory/restrictions" method="post"><input type="hidden" name="propertyId" value={propertyId} /><input type="hidden" name="ratePlanId" value={selectedRatePlan.id} /><input type="hidden" name="roomTypeId" value={selectedRoomType?.id ?? ''} /><div className="sf-form-row"><label className="sf-field">Start date<input type="date" name="startDate" required /></label><label className="sf-field">End date<input type="date" name="endDate" required /></label></div><div className="sf-form-row"><label className="sf-field">Minimum stay<input type="number" name="minStayNights" min={1} max={365} inputMode="numeric" /></label><label className="sf-field">Maximum stay<input type="number" name="maxStayNights" min={1} max={365} inputMode="numeric" /></label></div><label className="sf-checkbox"><input type="checkbox" name="closedToArrival" value="true" /><span>Closed to arrival</span></label><label className="sf-checkbox"><input type="checkbox" name="closedToDeparture" value="true" /><span>Closed to departure</span></label><p className="sf-field-hint">Set at least one stay or arrival/departure control.</p><button className="sf-button sf-button--primary" type="submit">Add restriction</button></form></aside> : null}
      </div>
    </> : null}
  </div>;
}
