import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { organizationRoleHasPermission } from '@/server/authorization/authorization-domain.ts';
import { readOrganizationAuthorization } from '@/server/authorization/authorization-service.ts';
import { parseInventoryPage, parseInventoryPageSize } from '@/server/inventory/hospitality-domain.ts';
import { listAppointmentInventory } from '@/server/inventory/appointment-service.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

const errors: Record<string, string> = {
  tenant: 'Choose an active organization before managing appointment inventory.',
  permission: 'You do not have permission to manage appointment inventory.',
  conflict: 'That appointment inventory code or schedule is already in use.',
  dependency: 'Remove dependent appointment inventory first.',
  unavailable: 'That appointment inventory record is not available in this organization.',
  validation: 'Check the appointment inventory details and try again.',
  server: 'The appointment inventory operation could not be completed. Try again.',
};

const statuses: Record<string, string> = {
  'service-created': 'Appointment service created.',
  'service-archived': 'Appointment service archived.',
  'staff-archived': 'Appointment staff member archived after active schedules and service assignments were cleared.',
};

function pageHref(input: {
  servicePage: number;
  staffPage: number;
  pageSize: number;
}) {
  const params = new URLSearchParams();
  if (input.servicePage > 1) params.set('servicePage', String(input.servicePage));
  if (input.staffPage > 1) params.set('staffPage', String(input.staffPage));
  if (input.pageSize !== 20) params.set('pageSize', String(input.pageSize));
  const query = params.toString();
  return query ? `/inventory/appointments?${query}` : '/inventory/appointments';
}

export default async function AppointmentInventoryPage({ searchParams }: {
  searchParams: Promise<{
    servicePage?: string;
    staffPage?: string;
    pageSize?: string;
    status?: string;
    error?: string;
  }>;
}) {
  const authState = await readAuthSessionState();
  const authRedirect = getAuthRequiredRedirect(authState);
  if (authRedirect) redirect(authRedirect);
  const session = authState.session;
  if (!session) throw new Error('Authenticated appointment inventory guard returned without a session');

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
      <p className="sf-eyebrow">Appointment inventory</p>
      <h1>Select an organization first</h1>
      <p>Appointment inventory is tenant-owned and requires an active organization.</p>
      <Link className="sf-button sf-button--primary" href="/account">Choose organization</Link>
    </section>;
  }
  if (!canRead) {
    return <section className="sf-inventory-empty">
      <p className="sf-eyebrow">Appointment inventory</p>
      <h1>Appointment inventory access is restricted</h1>
      <p>Your organization role does not include inventory access.</p>
    </section>;
  }

  const pageSize = parseInventoryPageSize(params.pageSize);
  const result = await listAppointmentInventory({
    organizationId: activeContext.organization.id,
    actorUserId: session.user.id,
    servicePage: parseInventoryPage(params.servicePage),
    staffPage: parseInventoryPage(params.staffPage),
    pageSize,
  });
  const { serviceResult, staffResult } = result;

  return <div className="sf-inventory-page">
    <header className="sf-inventory-page__header">
      <div>
        <p className="sf-eyebrow">Appointment inventory</p>
        <h1>Services and staff</h1>
        <p>Manage real tenant-owned appointment definitions and working-hour schedules for {activeContext.organization.name}.</p>
      </div>
      <div className="sf-image-scope__nav">
        <span className="sf-inventory-count">{serviceResult.total} services · {staffResult.total} staff</span>
        <Link className="sf-button sf-button--secondary" href="/inventory">Hospitality</Link>
        <Link className="sf-button sf-button--secondary" href="/inventory/tours">Tours</Link>
      </div>
    </header>

    {params.status && statuses[params.status] ? <p className="sf-alert sf-alert--success" role="status">{statuses[params.status]}</p> : null}
    {params.error && errors[params.error] ? <p className="sf-alert sf-alert--error" role="alert">{errors[params.error]}</p> : null}

    <div className="sf-inventory-layout">
      <section className="sf-inventory-card" aria-labelledby="appointment-services-title">
        <div className="sf-inventory-card__heading">
          <div><p className="sf-eyebrow">Service catalog</p><h2 id="appointment-services-title">Services</h2></div>
          <span>{serviceResult.total}</span>
        </div>
        {serviceResult.services.length === 0
          ? <div className="sf-empty-state"><h3>No appointment services yet</h3><p>{canManage ? 'Create the first service before assigning staff.' : 'No appointment services are available for this tenant.'}</p></div>
          : <ul className="sf-inventory-list">{serviceResult.services.map((service) => <li key={service.id}>
            <div className="sf-inventory-list__link">
              <div className="sf-inventory-list__primary">
                <div>
                  <strong>{service.name}</strong>
                  <span>{service.code} · {service.durationMinutes} min{service.bufferBeforeMinutes || service.bufferAfterMinutes ? ` · buffer ${service.bufferBeforeMinutes}/${service.bufferAfterMinutes} min` : ''}</span>
                </div>
              </div>
              <div className="sf-inventory-list__meta">
                <span className={`sf-status-badge${service.status === 'ARCHIVED' ? ' sf-status-badge--muted' : ''}`}>{service.status.toLowerCase()}</span>
                <span>{service._count.staffAssignments} staff</span>
                {canManage && service.status === 'ACTIVE' ? <form className="sf-form sf-form--inline" action={`/api/inventory/appointments/services/${service.id}/archive`} method="post">
                  <label className="sf-field">Confirm<input name="confirmation" required placeholder="ARCHIVE" autoCapitalize="characters" /></label>
                  <button className="sf-button sf-button--secondary sf-button--compact" type="submit">Archive</button>
                </form> : null}
              </div>
            </div>
          </li>)}</ul>}
        {serviceResult.total > pageSize ? <nav className="sf-pagination" aria-label="Appointment service pages">
          {serviceResult.page > 1 ? <Link className="sf-button sf-button--secondary sf-button--compact" href={pageHref({ servicePage: serviceResult.page - 1, staffPage: staffResult.page, pageSize })}>Previous</Link> : <span />}
          <span>Page {serviceResult.page} of {serviceResult.totalPages}</span>
          {serviceResult.page < serviceResult.totalPages ? <Link className="sf-button sf-button--secondary sf-button--compact" href={pageHref({ servicePage: serviceResult.page + 1, staffPage: staffResult.page, pageSize })}>Next</Link> : <span />}
        </nav> : null}
      </section>

      <section className="sf-inventory-card" aria-labelledby="appointment-staff-title">
        <div className="sf-inventory-card__heading">
          <div><p className="sf-eyebrow">Bookable resources</p><h2 id="appointment-staff-title">Staff</h2></div>
          <span>{staffResult.total}</span>
        </div>
        {staffResult.staff.length === 0
          ? <div className="sf-empty-state"><h3>No appointment staff yet</h3><p>{canManage ? 'Create the first staff resource to configure services and weekly schedules.' : 'No appointment staff are available for this tenant.'}</p></div>
          : <ul className="sf-inventory-list">{staffResult.staff.map((staff) => <li key={staff.id}>
            <div className="sf-inventory-list__link">
              <Link className="sf-inventory-list__primary" href={`/inventory/appointments/${staff.id}`}>
                <div><strong>{staff.name}</strong><span>{staff.code} · {staff.timezone}</span></div>
              </Link>
              <div className="sf-inventory-list__meta">
                <span className={`sf-status-badge${staff.status === 'ARCHIVED' ? ' sf-status-badge--muted' : ''}`}>{staff.status.toLowerCase()}</span>
                <span>{staff._count.serviceAssignments} services</span>
                <span>{staff._count.schedules} schedules</span>
              </div>
            </div>
          </li>)}</ul>}
        {staffResult.total > pageSize ? <nav className="sf-pagination" aria-label="Appointment staff pages">
          {staffResult.page > 1 ? <Link className="sf-button sf-button--secondary sf-button--compact" href={pageHref({ servicePage: serviceResult.page, staffPage: staffResult.page - 1, pageSize })}>Previous</Link> : <span />}
          <span>Page {staffResult.page} of {staffResult.totalPages}</span>
          {staffResult.page < staffResult.totalPages ? <Link className="sf-button sf-button--secondary sf-button--compact" href={pageHref({ servicePage: serviceResult.page, staffPage: staffResult.page + 1, pageSize })}>Next</Link> : <span />}
        </nav> : null}
      </section>
    </div>

    {canManage ? <div className="sf-inventory-layout">
      <section className="sf-inventory-card sf-inventory-card--create">
        <p className="sf-eyebrow">New service</p><h2>Create appointment service</h2>
        <p>Duration and buffers define inventory timing only. No booking or pricing behavior is implied here.</p>
        <form className="sf-form" action="/api/inventory/appointments/services" method="post">
          <label className="sf-field">Name<input name="name" maxLength={160} required /></label>
          <label className="sf-field">Code<input name="code" maxLength={32} required autoCapitalize="characters" /></label>
          <div className="sf-form-row">
            <label className="sf-field">Duration minutes<input name="durationMinutes" type="number" min={5} max={1440} step={1} required /></label>
            <label className="sf-field">Buffer before<input name="bufferBeforeMinutes" type="number" min={0} max={480} step={1} defaultValue={0} required /></label>
            <label className="sf-field">Buffer after<input name="bufferAfterMinutes" type="number" min={0} max={480} step={1} defaultValue={0} required /></label>
          </div>
          <label className="sf-field">Description<textarea name="description" maxLength={1000} rows={3} /></label>
          <button className="sf-button sf-button--primary" type="submit">Create service</button>
        </form>
      </section>

      <section className="sf-inventory-card sf-inventory-card--create">
        <p className="sf-eyebrow">New staff resource</p><h2>Create appointment staff</h2>
        <p>Staff codes are tenant-local. The timezone controls how weekly working hours are presented.</p>
        <form className="sf-form" action="/api/inventory/appointments/staff" method="post">
          <label className="sf-field">Name<input name="name" maxLength={160} required /></label>
          <label className="sf-field">Code<input name="code" maxLength={32} required autoCapitalize="characters" /></label>
          <label className="sf-field">Timezone<input name="timezone" maxLength={80} required defaultValue={activeContext.organization.timezone} /></label>
          <label className="sf-field">Description<textarea name="description" maxLength={1000} rows={3} /></label>
          <button className="sf-button sf-button--primary" type="submit">Create staff</button>
        </form>
      </section>
    </div> : null}
  </div>;
}
