import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { organizationRoleHasPermission } from '@/server/authorization/authorization-domain.ts';
import { readOrganizationAuthorization } from '@/server/authorization/authorization-service.ts';
import { parseInventoryPage, parseInventoryPageSize } from '@/server/inventory/hospitality-domain.ts';
import {
  listHospitalityRatePlanRoomTypes,
  listHospitalityRatePlans,
  readHospitalityRatePlan,
} from '@/server/inventory/hospitality-rate-plan-service.ts';
import { readHospitalityProperty } from '@/server/inventory/hospitality-service.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

const errors: Record<string, string> = {
  permission: 'You do not have permission to manage rate plans.',
  conflict: 'That rate plan code is already in use for this property.',
  dependency: 'Remove all room-type assignments before archiving this rate plan.',
  unavailable: 'That rate plan or room type is not available for this property.',
  validation: 'Check the rate plan details and try again.',
  server: 'The rate plan operation could not be completed. Try again.',
};

const statuses: Record<string, string> = {
  'rate-plan-created': 'Rate plan created.',
  'rate-plan-archived': 'Rate plan archived.',
  'rate-plan-assigned': 'Rate plan assigned to room type.',
  'rate-plan-removed': 'Rate plan removed from room type.',
};

function ratePlanHref(propertyId: string, input: {
  ratePlanId?: string;
  page?: number;
  roomTypePage?: number;
  pageSize: number;
}) {
  const params = new URLSearchParams();
  if (input.ratePlanId) params.set('ratePlan', input.ratePlanId);
  if ((input.page ?? 1) > 1) params.set('page', String(input.page));
  if ((input.roomTypePage ?? 1) > 1) params.set('roomTypePage', String(input.roomTypePage));
  if (input.pageSize !== 20) params.set('pageSize', String(input.pageSize));
  const query = params.toString();
  return query ? `/inventory/${propertyId}/rate-plans?${query}` : `/inventory/${propertyId}/rate-plans`;
}

export default async function HospitalityRatePlansPage({
  params,
  searchParams,
}: {
  params: Promise<{ 'property-id': string }>;
  searchParams: Promise<{
    ratePlan?: string;
    page?: string;
    roomTypePage?: string;
    pageSize?: string;
    status?: string;
    error?: string;
  }>;
}) {
  const authState = await readAuthSessionState();
  const authRedirect = getAuthRequiredRedirect(authState);
  if (authRedirect) redirect(authRedirect);
  const session = authState.session;
  if (!session) throw new Error('Authenticated rate plan guard returned without a session');

  const routeParams = await params;
  const query = await searchParams;
  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) redirect('/inventory?error=tenant');
  const organization = activeContext.organization;
  const authorization = await readOrganizationAuthorization({ organizationId: organization.id, userId: session.user.id });
  const canRead = Boolean(authorization?.platformAdmin || (authorization?.role && organizationRoleHasPermission(authorization.role, 'inventory:read')));
  const canManage = Boolean(authorization?.platformAdmin || (authorization?.role && organizationRoleHasPermission(authorization.role, 'inventory:manage')));
  if (!canRead) return <section className="sf-inventory-empty"><p className="sf-eyebrow">Inventory</p><h1>Rate plan access is restricted</h1><p>Your organization role does not include inventory access.</p></section>;

  const propertyId = routeParams['property-id'];
  const property = await readHospitalityProperty({ organizationId: organization.id, actorUserId: session.user.id, propertyId });
  if (!property) notFound();

  const pageSize = parseInventoryPageSize(query.pageSize);
  const ratePlans = await listHospitalityRatePlans({
    organizationId: organization.id,
    actorUserId: session.user.id,
    propertyId,
    page: parseInventoryPage(query.page),
    pageSize,
  });
  const requestedRatePlan = query.ratePlan ? await readHospitalityRatePlan({
    organizationId: organization.id,
    actorUserId: session.user.id,
    propertyId,
    ratePlanId: query.ratePlan,
  }) : null;
  const selectedRatePlan = requestedRatePlan ?? ratePlans.ratePlans[0] ?? null;
  const roomTypes = selectedRatePlan ? await listHospitalityRatePlanRoomTypes({
    organizationId: organization.id,
    actorUserId: session.user.id,
    propertyId,
    ratePlanId: selectedRatePlan.id,
    page: parseInventoryPage(query.roomTypePage),
    pageSize,
  }) : null;
  const canMutateProperty = canManage && property.status === 'ACTIVE';
  const canMutateSelectedPlan = canMutateProperty && selectedRatePlan?.status === 'ACTIVE';

  return <div className="sf-inventory-page">
    <header className="sf-inventory-page__header">
      <div>
        <Link className="sf-back-link" href={`/inventory/${propertyId}`}>← {property.name}</Link>
        <p className="sf-eyebrow">Hospitality inventory</p>
        <h1>Rate plans</h1>
        <p>Define sellable commercial plan identities now; prices and availability restrictions remain separate later layers.</p>
      </div>
      <div className="sf-image-scope__nav">
        <Link className="sf-button sf-button--secondary sf-button--compact" href={`/inventory/${propertyId}/images`}>Images</Link>
        <span className="sf-inventory-count">{ratePlans.total} plans</span>
      </div>
    </header>

    {query.status && statuses[query.status] ? <p className="sf-alert sf-alert--success" role="status">{statuses[query.status]}</p> : null}
    {query.error && errors[query.error] ? <p className="sf-alert sf-alert--error" role="alert">{errors[query.error]}</p> : null}
    {property.status === 'ARCHIVED' ? <p className="sf-alert" role="status">This property is archived. Rate-plan configuration is read-only.</p> : null}

    <div className={`sf-inventory-layout${canMutateProperty ? '' : ' sf-inventory-layout--single'}`}>
      <section className="sf-inventory-card" aria-labelledby="rate-plans-title">
        <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Commercial definitions</p><h2 id="rate-plans-title">Property rate plans</h2></div><span>{ratePlans.total} total</span></div>
        {ratePlans.ratePlans.length === 0 ? <div className="sf-empty-state"><h3>No rate plans yet</h3><p>{canMutateProperty ? 'Create the first rate plan for this property.' : 'No rate plans are configured for this property.'}</p></div> : <ul className="sf-inventory-list">{ratePlans.ratePlans.map((ratePlan) => <li key={ratePlan.id}><Link className={`sf-inventory-list__link${selectedRatePlan?.id === ratePlan.id ? ' sf-inventory-list__link--selected' : ''}`} href={ratePlanHref(propertyId, { ratePlanId: ratePlan.id, page: ratePlans.page, pageSize })}><div><strong>{ratePlan.name}</strong><span>{ratePlan.code}{ratePlan.description ? ` · ${ratePlan.description}` : ''}</span></div><div className="sf-inventory-list__meta"><span className={`sf-status-badge${ratePlan.status === 'ARCHIVED' ? ' sf-status-badge--muted' : ''}`}>{ratePlan.status.toLowerCase()}</span><span>{ratePlan._count.roomTypeAssignments} room types</span></div></Link></li>)}</ul>}
        {ratePlans.total > pageSize ? <nav className="sf-pagination" aria-label="Rate plan pages">{ratePlans.page > 1 ? <Link className="sf-button sf-button--secondary sf-button--compact" href={ratePlanHref(propertyId, { ratePlanId: selectedRatePlan?.id, page: ratePlans.page - 1, pageSize })}>Previous</Link> : <span />}<span>Page {ratePlans.page} of {ratePlans.totalPages}</span>{ratePlans.page < ratePlans.totalPages ? <Link className="sf-button sf-button--secondary sf-button--compact" href={ratePlanHref(propertyId, { ratePlanId: selectedRatePlan?.id, page: ratePlans.page + 1, pageSize })}>Next</Link> : <span />}</nav> : null}
      </section>

      {canMutateProperty ? <aside className="sf-inventory-card sf-inventory-card--create"><p className="sf-eyebrow">New plan</p><h2>Create rate plan</h2><p>Rate plans identify a sellable commercial option. Do not encode prices or date restrictions in the name.</p><form className="sf-form" action="/api/inventory/rate-plans" method="post"><input type="hidden" name="propertyId" value={propertyId} /><label className="sf-field">Rate plan name<input name="name" maxLength={120} required /></label><label className="sf-field">Code<input name="code" maxLength={32} required autoCapitalize="characters" /></label><label className="sf-field">Description<textarea name="description" maxLength={300} rows={4} /></label><button className="sf-button sf-button--primary" type="submit">Create rate plan</button></form></aside> : null}
    </div>

    {selectedRatePlan && roomTypes ? <section className="sf-inventory-card sf-inventory-rooms" aria-labelledby="rate-plan-room-types-title">
      <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Room-type availability</p><h2 id="rate-plan-room-types-title">{selectedRatePlan.name}</h2><p>Choose which room types can later publish prices and restrictions under this plan.</p></div><span>{selectedRatePlan._count.roomTypeAssignments} assigned</span></div>
      {roomTypes.roomTypes.length === 0 ? <div className="sf-empty-state"><h3>No room types yet</h3><p>Create room types before assigning this rate plan.</p></div> : <div className="sf-room-table-wrap"><table className="sf-room-table"><thead><tr><th scope="col">Room type</th><th scope="col">Code</th><th scope="col">Lifecycle</th><th scope="col">Plan</th>{canMutateSelectedPlan ? <th scope="col">Action</th> : null}</tr></thead><tbody>{roomTypes.roomTypes.map((roomType) => {
        const assignment = roomType.ratePlanAssignments[0];
        return <tr key={roomType.id}><th scope="row">{roomType.name}</th><td>{roomType.code}</td><td><span className={`sf-status-badge${roomType.status === 'ARCHIVED' ? ' sf-status-badge--muted' : ''}`}>{roomType.status.toLowerCase()}</span></td><td>{assignment ? 'Assigned' : 'Not assigned'}</td>{canMutateSelectedPlan ? <td>{roomType.status === 'ACTIVE' ? <form action="/api/inventory/rate-plan-room-types" method="post"><input type="hidden" name="propertyId" value={propertyId} /><input type="hidden" name="roomTypeId" value={roomType.id} /><input type="hidden" name="ratePlanId" value={selectedRatePlan.id} /><input type="hidden" name="action" value={assignment ? 'remove' : 'assign'} /><button className={`sf-button ${assignment ? 'sf-button--secondary' : 'sf-button--primary'} sf-button--compact`} type="submit">{assignment ? 'Remove' : 'Assign'}</button></form> : '—'}</td> : null}</tr>;
      })}</tbody></table></div>}
      {roomTypes.total > pageSize ? <nav className="sf-pagination" aria-label="Rate plan room type pages">{roomTypes.page > 1 ? <Link className="sf-button sf-button--secondary sf-button--compact" href={ratePlanHref(propertyId, { ratePlanId: selectedRatePlan.id, page: ratePlans.page, roomTypePage: roomTypes.page - 1, pageSize })}>Previous</Link> : <span />}<span>Page {roomTypes.page} of {roomTypes.totalPages}</span>{roomTypes.page < roomTypes.totalPages ? <Link className="sf-button sf-button--secondary sf-button--compact" href={ratePlanHref(propertyId, { ratePlanId: selectedRatePlan.id, page: ratePlans.page, roomTypePage: roomTypes.page + 1, pageSize })}>Next</Link> : <span />}</nav> : null}
      {canMutateSelectedPlan ? <form className="sf-danger-zone" action={`/api/inventory/rate-plans/${selectedRatePlan.id}/archive`} method="post"><input type="hidden" name="propertyId" value={propertyId} /><div><strong>Archive rate plan</strong><span>All room-type assignments must be removed first. Existing history remains preserved.</span></div><label className="sf-field">Confirmation<input name="confirmation" placeholder="ARCHIVE" required /></label><button className="sf-button sf-button--danger" type="submit">Archive rate plan</button></form> : null}
    </section> : null}
  </div>;
}
