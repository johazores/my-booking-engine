import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { organizationRoleHasPermission } from '@/server/authorization/authorization-domain.ts';
import { readOrganizationAuthorization } from '@/server/authorization/authorization-service.ts';
import { parseInventoryPage, parseInventoryPageSize } from '@/server/inventory/hospitality-domain.ts';
import {
  readAppointmentStaffInventory,
  AppointmentInventoryUnavailableError,
} from '@/server/inventory/appointment-service.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

const errors: Record<string, string> = {
  permission: 'You do not have permission to manage appointment inventory.',
  conflict: 'That working-hours schedule overlaps another active schedule.',
  dependency: 'Clear active schedules and service assignments before archiving this staff member.',
  unavailable: 'That appointment inventory record is not available in this organization.',
  validation: 'Check the appointment inventory details and try again.',
  server: 'The appointment inventory operation could not be completed. Try again.',
};

const statuses: Record<string, string> = {
  'staff-created': 'Appointment staff member created.',
  'schedule-created': 'Weekly working-hours schedule created.',
  'schedule-archived': 'Working-hours schedule archived.',
  'service-assigned': 'Appointment service assigned to this staff member.',
  'service-removed': 'Appointment service assignment removed.',
};

function minuteLabel(value: number) {
  if (value === 1440) return '24:00';
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function detailHref(input: {
  staffId: string;
  schedulePage: number;
  servicePage: number;
  pageSize: number;
}) {
  const params = new URLSearchParams();
  if (input.schedulePage > 1) params.set('schedulePage', String(input.schedulePage));
  if (input.servicePage > 1) params.set('servicePage', String(input.servicePage));
  if (input.pageSize !== 20) params.set('pageSize', String(input.pageSize));
  const query = params.toString();
  const path = `/inventory/appointments/${encodeURIComponent(input.staffId)}`;
  return query ? `${path}?${query}` : path;
}

export default async function AppointmentStaffDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ 'staff-id': string }>;
  searchParams: Promise<{
    schedulePage?: string;
    servicePage?: string;
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

  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) redirect('/inventory/appointments?error=tenant');
  const authorization = await readOrganizationAuthorization({
    organizationId: activeContext.organization.id,
    userId: session.user.id,
  });
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
      <p className="sf-eyebrow">Appointment inventory</p>
      <h1>Appointment inventory access is restricted</h1>
      <p>Your organization role does not include inventory access.</p>
    </section>;
  }

  const routeParams = await params;
  const query = await searchParams;
  const pageSize = parseInventoryPageSize(query.pageSize);
  let detail: Awaited<ReturnType<typeof readAppointmentStaffInventory>>;
  try {
    detail = await readAppointmentStaffInventory({
      organizationId: activeContext.organization.id,
      actorUserId: session.user.id,
      staffId: routeParams['staff-id'],
      schedulePage: parseInventoryPage(query.schedulePage),
      servicePage: parseInventoryPage(query.servicePage),
      pageSize,
    });
  } catch (error) {
    if (error instanceof AppointmentInventoryUnavailableError) notFound();
    throw error;
  }

  const { staff, scheduleResult, serviceResult } = detail;
  const isActive = staff.status === 'ACTIVE';

  return <div className="sf-inventory-page">
    <header className="sf-inventory-page__header">
      <div>
        <p className="sf-eyebrow">Appointment staff</p>
        <h1>{staff.name}</h1>
        <p>{staff.code} · {staff.timezone}</p>
      </div>
      <div className="sf-image-scope__nav">
        <span className={`sf-status-badge${isActive ? '' : ' sf-status-badge--muted'}`}>{staff.status.toLowerCase()}</span>
        <Link className="sf-button sf-button--secondary" href="/inventory/appointments">Back to appointments</Link>
      </div>
    </header>

    {query.status && statuses[query.status] ? <p className="sf-alert sf-alert--success" role="status">{statuses[query.status]}</p> : null}
    {query.error && errors[query.error] ? <p className="sf-alert sf-alert--error" role="alert">{errors[query.error]}</p> : null}
    {staff.description ? <section className="sf-inventory-card"><p className="sf-eyebrow">Staff notes</p><p>{staff.description}</p></section> : null}

    <div className="sf-inventory-layout">
      <section className="sf-inventory-card" aria-labelledby="appointment-schedules-title">
        <div className="sf-inventory-card__heading">
          <div><p className="sf-eyebrow">Weekly availability definition</p><h2 id="appointment-schedules-title">Working hours</h2></div>
          <span>{scheduleResult.total}</span>
        </div>
        {scheduleResult.schedules.length === 0
          ? <div className="sf-empty-state"><h3>No working hours yet</h3><p>Create weekly working hours before a later appointment availability layer can derive bookable slots.</p></div>
          : <ul className="sf-inventory-list">{scheduleResult.schedules.map((schedule) => <li key={schedule.id}>
            <div className="sf-inventory-list__link">
              <div className="sf-inventory-list__primary">
                <div><strong>{dayNames[schedule.dayOfWeek]}</strong><span>{minuteLabel(schedule.startsAtMinute)}–{minuteLabel(schedule.endsAtMinute)} · {staff.timezone}</span></div>
              </div>
              <div className="sf-inventory-list__meta">
                <span className={`sf-status-badge${schedule.status === 'ARCHIVED' ? ' sf-status-badge--muted' : ''}`}>{schedule.status.toLowerCase()}</span>
                {canManage && schedule.status === 'ACTIVE' ? <form className="sf-form sf-form--inline" action={`/api/inventory/appointments/staff/${staff.id}/schedules/${schedule.id}/archive`} method="post">
                  <label className="sf-field">Confirm<input name="confirmation" required placeholder="ARCHIVE" autoCapitalize="characters" /></label>
                  <button className="sf-button sf-button--secondary sf-button--compact" type="submit">Archive schedule</button>
                </form> : null}
              </div>
            </div>
          </li>)}</ul>}
        {scheduleResult.total > pageSize ? <nav className="sf-pagination" aria-label="Appointment schedule pages">
          {scheduleResult.page > 1 ? <Link className="sf-button sf-button--secondary sf-button--compact" href={detailHref({ staffId: staff.id, schedulePage: scheduleResult.page - 1, servicePage: serviceResult.page, pageSize })}>Previous</Link> : <span />}
          <span>Page {scheduleResult.page} of {scheduleResult.totalPages}</span>
          {scheduleResult.page < scheduleResult.totalPages ? <Link className="sf-button sf-button--secondary sf-button--compact" href={detailHref({ staffId: staff.id, schedulePage: scheduleResult.page + 1, servicePage: serviceResult.page, pageSize })}>Next</Link> : <span />}
        </nav> : null}
      </section>

      <section className="sf-inventory-card" aria-labelledby="appointment-services-assigned-title">
        <div className="sf-inventory-card__heading">
          <div><p className="sf-eyebrow">Service eligibility</p><h2 id="appointment-services-assigned-title">Assigned services</h2></div>
          <span>{serviceResult.total}</span>
        </div>
        {serviceResult.assignments.length === 0
          ? <div className="sf-empty-state"><h3>No services assigned</h3><p>Assign an active service code to define which services this staff member can perform.</p></div>
          : <ul className="sf-inventory-list">{serviceResult.assignments.map((assignment) => <li key={assignment.serviceId}>
            <div className="sf-inventory-list__link">
              <div className="sf-inventory-list__primary"><div><strong>{assignment.service.name}</strong><span>{assignment.service.code} · {assignment.service.durationMinutes} min</span></div></div>
              <div className="sf-inventory-list__meta">
                <span className={`sf-status-badge${assignment.service.status === 'ARCHIVED' ? ' sf-status-badge--muted' : ''}`}>{assignment.service.status.toLowerCase()}</span>
                {canManage && isActive ? <form className="sf-form sf-form--inline" action={`/api/inventory/appointments/staff/${staff.id}/services/${assignment.serviceId}/remove`} method="post">
                  <label className="sf-field">Confirm<input name="confirmation" required placeholder="REMOVE" autoCapitalize="characters" /></label>
                  <button className="sf-button sf-button--secondary sf-button--compact" type="submit">Remove</button>
                </form> : null}
              </div>
            </div>
          </li>)}</ul>}
        {serviceResult.total > pageSize ? <nav className="sf-pagination" aria-label="Assigned appointment service pages">
          {serviceResult.page > 1 ? <Link className="sf-button sf-button--secondary sf-button--compact" href={detailHref({ staffId: staff.id, schedulePage: scheduleResult.page, servicePage: serviceResult.page - 1, pageSize })}>Previous</Link> : <span />}
          <span>Page {serviceResult.page} of {serviceResult.totalPages}</span>
          {serviceResult.page < serviceResult.totalPages ? <Link className="sf-button sf-button--secondary sf-button--compact" href={detailHref({ staffId: staff.id, schedulePage: scheduleResult.page, servicePage: serviceResult.page + 1, pageSize })}>Next</Link> : <span />}
        </nav> : null}
      </section>
    </div>

    {canManage && isActive ? <div className="sf-inventory-layout">
      <section className="sf-inventory-card sf-inventory-card--create">
        <p className="sf-eyebrow">Weekly working hours</p><h2>Add schedule window</h2>
        <p>Windows are same-day recurring definitions in {staff.timezone}. Overlapping active windows are rejected.</p>
        <form className="sf-form" action={`/api/inventory/appointments/staff/${staff.id}/schedules`} method="post">
          <label className="sf-field">Day<select name="dayOfWeek" defaultValue="1">
            {dayNames.map((name, index) => <option key={name} value={index}>{name}</option>)}
          </select></label>
          <div className="sf-form-row">
            <label className="sf-field">Starts<input name="startsAt" type="time" required /></label>
            <label className="sf-field">Ends<input name="endsAt" type="time" required /></label>
          </div>
          <button className="sf-button sf-button--primary" type="submit">Create working hours</button>
        </form>
      </section>

      <section className="sf-inventory-card sf-inventory-card--create">
        <p className="sf-eyebrow">Service eligibility</p><h2>Assign service</h2>
        <p>Use the canonical service code from the service catalog. This avoids an unbounded hidden catalog read.</p>
        <form className="sf-form" action={`/api/inventory/appointments/staff/${staff.id}/services`} method="post">
          <label className="sf-field">Service code<input name="serviceCode" maxLength={32} required autoCapitalize="characters" /></label>
          <button className="sf-button sf-button--primary" type="submit">Assign service</button>
        </form>
      </section>
    </div> : null}

    {canManage && isActive ? <section className="sf-inventory-card">
      <p className="sf-eyebrow">Lifecycle</p><h2>Archive staff resource</h2>
      <p>Archive active schedules and remove service assignments first. Historical rows remain inventory evidence.</p>
      <form className="sf-form sf-form--inline" action={`/api/inventory/appointments/staff/${staff.id}/archive`} method="post">
        <label className="sf-field">Type ARCHIVE to confirm<input name="confirmation" required autoCapitalize="characters" /></label>
        <button className="sf-button sf-button--secondary" type="submit">Archive staff</button>
      </form>
    </section> : null}
  </div>;
}
