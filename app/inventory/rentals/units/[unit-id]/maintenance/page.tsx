import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { organizationRoleHasPermission } from '@/server/authorization/authorization-domain.ts';
import { readOrganizationAuthorization } from '@/server/authorization/authorization-service.ts';
import { parseInventoryPage, parseInventoryPageSize } from '@/server/inventory/hospitality-domain.ts';
import { readRentalUnitMaintenanceWorkOrders } from '@/server/inventory/rental-maintenance-service.ts';
import { readRentalUnitOperationalState } from '@/server/inventory/rental-unit-operational-service.ts';
import { RentalInventoryUnavailableError } from '@/server/inventory/rental-service.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

const errors: Record<string, string> = {
  permission: 'You do not have permission to manage rental maintenance.',
  conflict: 'That maintenance change conflicts with the current unit or work-order state.',
  dependency: 'Resolve dependent rental inventory before changing this maintenance record.',
  unavailable: 'That rental unit or maintenance work order is not available in this organization.',
  validation: 'Check the maintenance details and try again.',
  server: 'The maintenance operation could not be completed. Try again.',
};

const statuses: Record<string, string> = {
  'maintenance-opened': 'Maintenance work order opened. The unit is out of service.',
  'maintenance-updated': 'Maintenance work order updated.',
};

const statusLabels = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
} as const;

function maintenanceHref(unitId: string, page: number, pageSize: number) {
  const params = new URLSearchParams();
  if (page > 1) params.set('page', String(page));
  if (pageSize !== 20) params.set('pageSize', String(pageSize));
  const query = params.toString();
  const path = `/inventory/rentals/units/${encodeURIComponent(unitId)}/maintenance`;
  return query ? `${path}?${query}` : path;
}

function timestamp(value: Date | null) {
  return value ? value.toISOString() : 'Not recorded';
}

export default async function RentalUnitMaintenancePage({
  params,
  searchParams,
}: {
  params: Promise<{ 'unit-id': string }>;
  searchParams: Promise<{ page?: string; pageSize?: string; status?: string; error?: string }>;
}) {
  const authState = await readAuthSessionState();
  const authRedirect = getAuthRequiredRedirect(authState);
  if (authRedirect) redirect(authRedirect);
  const session = authState.session;
  if (!session) throw new Error('Authenticated rental maintenance guard returned without a session');

  const routeParams = await params;
  const query = await searchParams;
  const unitId = routeParams['unit-id'];
  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) redirect('/inventory?error=tenant');

  const authorization = await readOrganizationAuthorization({
    organizationId: activeContext.organization.id,
    userId: session.user.id,
  });
  const canManage = Boolean(
    authorization.platformAdmin ||
      (authorization.role && organizationRoleHasPermission(authorization.role, 'inventory:manage')),
  );
  const page = parseInventoryPage(query.page);
  const pageSize = parseInventoryPageSize(query.pageSize);

  let maintenance: Awaited<ReturnType<typeof readRentalUnitMaintenanceWorkOrders>>;
  let operationalState: Awaited<ReturnType<typeof readRentalUnitOperationalState>>;
  try {
    [maintenance, operationalState] = await Promise.all([
      readRentalUnitMaintenanceWorkOrders({
        organizationId: activeContext.organization.id,
        actorUserId: session.user.id,
        unitId,
        page,
        pageSize,
      }),
      readRentalUnitOperationalState({
        organizationId: activeContext.organization.id,
        actorUserId: session.user.id,
        unitId,
      }),
    ]);
  } catch (error) {
    if (error instanceof RentalInventoryUnavailableError) notFound();
    throw error;
  }

  const createIdempotencyKey = `rental-maintenance:${randomUUID()}`;

  return <div className="sf-inventory-page">
    <header className="sf-inventory-page__header">
      <div>
        <p className="sf-eyebrow">Rental maintenance</p>
        <h1>{maintenance.unit.name}</h1>
        <p>{maintenance.unit.code} · {operationalState.status === 'OUT_OF_SERVICE' ? 'Out of service' : 'Available'} · durable work-order history</p>
      </div>
      <div className="sf-image-scope__nav">
        <Link className="sf-button sf-button--secondary" href={`/inventory/rentals/units/${encodeURIComponent(unitId)}`}>Unit</Link>
        <Link className="sf-button sf-button--secondary" href="/inventory/rentals">All rentals</Link>
      </div>
    </header>

    {query.status && statuses[query.status] ? <p className="sf-alert sf-alert--success" role="status">{statuses[query.status]}</p> : null}
    {query.error && errors[query.error] ? <p className="sf-alert sf-alert--error" role="alert">{errors[query.error]}</p> : null}
    {operationalState.status === 'OUT_OF_SERVICE' ? <p className="sf-alert" role="status"><strong>Unit remains out of service.</strong> {operationalState.reason ?? 'Operational hold is active.'} Complete or cancel active maintenance first, then explicitly return the unit to service from the unit page after verification.</p> : null}

    <div className={`sf-inventory-layout${canManage ? '' : ' sf-inventory-layout--single'}`}>
      <section className="sf-inventory-card" aria-labelledby="rental-maintenance-history-title">
        <div className="sf-inventory-card__heading">
          <div><p className="sf-eyebrow">Work-order history</p><h2 id="rental-maintenance-history-title">Maintenance</h2></div>
          <span>{maintenance.total} total · {maintenance.activeTotal} active</span>
        </div>

        {maintenance.items.length === 0 ? <div className="sf-empty-state"><h3>No maintenance work orders</h3><p>Open a real work order when this unit needs inspection, repair, or other service.</p></div> : <ul className="sf-inventory-list">
          {maintenance.items.map((workOrder) => <li key={workOrder.id}>
            <div className="sf-inventory-list__link">
              <div className="sf-inventory-list__primary">
                <div>
                  <strong>{workOrder.title}</strong>
                  <span>{statusLabels[workOrder.status]} · opened {timestamp(workOrder.openedAt)}</span>
                  {workOrder.description ? <span>{workOrder.description}</span> : null}
                  {workOrder.completionNotes ? <span>Completion: {workOrder.completionNotes}</span> : null}
                  {workOrder.cancellationReason ? <span>Cancelled: {workOrder.cancellationReason}</span> : null}
                </div>
              </div>
            </div>
            {canManage && (workOrder.status === 'OPEN' || workOrder.status === 'IN_PROGRESS') ? <div className="sf-form">
              {workOrder.status === 'OPEN' ? <form action={`/api/inventory/rentals/units/${unitId}/maintenance/${workOrder.id}/transition`} method="post"><input type="hidden" name="status" value="IN_PROGRESS" /><button className="sf-button sf-button--secondary sf-button--compact" type="submit">Start work</button></form> : null}
              <form className="sf-form" action={`/api/inventory/rentals/units/${unitId}/maintenance/${workOrder.id}/transition`} method="post"><input type="hidden" name="status" value="COMPLETED" /><label className="sf-field">Completion notes<textarea name="completionNotes" maxLength={2000} rows={2} /></label><button className="sf-button sf-button--primary sf-button--compact" type="submit">Complete work</button></form>
              <form className="sf-form" action={`/api/inventory/rentals/units/${unitId}/maintenance/${workOrder.id}/transition`} method="post"><input type="hidden" name="status" value="CANCELLED" /><label className="sf-field">Cancellation reason<input name="cancellationReason" maxLength={500} required /></label><button className="sf-button sf-button--secondary sf-button--compact" type="submit">Cancel work order</button></form>
            </div> : null}
          </li>)}
        </ul>}

        {maintenance.totalPages > 1 ? <nav className="sf-pagination" aria-label="Rental maintenance pages">
          {maintenance.page > 1 ? <Link className="sf-button sf-button--secondary sf-button--compact" href={maintenanceHref(unitId, maintenance.page - 1, pageSize)}>Previous</Link> : <span />}
          <span>Page {maintenance.page} of {maintenance.totalPages}</span>
          {maintenance.page < maintenance.totalPages ? <Link className="sf-button sf-button--secondary sf-button--compact" href={maintenanceHref(unitId, maintenance.page + 1, pageSize)}>Next</Link> : <span />}
        </nav> : null}
      </section>

      {canManage ? <aside className="sf-inventory-card sf-inventory-card--create">
        <p className="sf-eyebrow">New maintenance</p>
        <h2>Open work order</h2>
        <form className="sf-form" action={`/api/inventory/rentals/units/${unitId}/maintenance`} method="post">
          <input type="hidden" name="idempotencyKey" value={createIdempotencyKey} />
          <label className="sf-field">Title<input name="title" maxLength={160} required /></label>
          <label className="sf-field">Description<textarea name="description" maxLength={2000} rows={5} /></label>
          <p className="sf-field-hint">Opening maintenance takes the unit out of service if needed. Existing bookings are not automatically cancelled, moved, refunded, or extended.</p>
          <button className="sf-button sf-button--primary" type="submit">Open work order</button>
        </form>
      </aside> : null}
    </div>
  </div>;
}
