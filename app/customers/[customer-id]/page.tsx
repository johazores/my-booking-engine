import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { organizationRoleHasPermission } from '@/server/authorization/authorization-domain.ts';
import { readOrganizationAuthorization } from '@/server/authorization/authorization-service.ts';
import { readCustomerWithActivity } from '@/server/customers/customer-service.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';
import { assertUuidIdentifier } from '@/server/tenancy/tenant-scope.ts';

const errors: Record<string, string> = {
  permission: 'You do not have permission to manage customers.',
  email: 'A customer with that email already exists in this organization.',
  validation: 'Check the customer details and try again.',
  unavailable: 'This customer is no longer available for that operation.',
  'archive-confirmation': 'Type ARCHIVE exactly to confirm customer archival.',
  server: 'The customer operation could not be completed. Try again.',
};

const statuses: Record<string, string> = {
  created: 'Customer created successfully.',
  updated: 'Customer details updated and audited.',
};

const activityLabels: Record<string, string> = {
  'customer.created': 'Customer created',
  'customer.updated': 'Customer details updated',
  'customer.archived': 'Customer archived',
};

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ 'customer-id': string }>;
  searchParams: Promise<{ status?: string; error?: string }>;
}) {
  const authState = await readAuthSessionState();
  const authRedirect = getAuthRequiredRedirect(authState);
  if (authRedirect) redirect(authRedirect);
  const session = authState.session;
  if (!session) throw new Error('Authenticated customer detail guard returned without a session');

  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) redirect('/customers?error=tenant');
  const authorization = await readOrganizationAuthorization({
    organizationId: activeContext.organization.id,
    userId: session.user.id,
  });
  const canRead = Boolean(
    authorization?.platformAdmin ||
    (authorization?.role && organizationRoleHasPermission(authorization.role, 'customer:read')),
  );
  if (!canRead) redirect('/customers?error=permission');
  const canManage = Boolean(
    authorization?.platformAdmin ||
    (authorization?.role && organizationRoleHasPermission(authorization.role, 'customer:manage')),
  );

  const routeParams = await params;
  const customerId = routeParams['customer-id'];
  try {
    assertUuidIdentifier(customerId, 'customerId');
  } catch {
    notFound();
  }
  const detail = await readCustomerWithActivity({
    organizationId: activeContext.organization.id,
    actorUserId: session.user.id,
    customerId,
  });
  if (!detail) notFound();
  const query = await searchParams;
  const customer = detail.customer;

  return (
    <div className="sf-customer-detail">
      <div className="sf-customer-detail__back"><Link href="/customers">← Back to customers</Link></div>
      <header className="sf-customer-detail__header">
        <div>
          <p className="sf-eyebrow">Customer record</p>
          <h1>{customer.firstName} {customer.lastName}</h1>
          <p>{customer.email ?? customer.phone ?? 'No contact details saved'}</p>
        </div>
        <span className={`sf-status-badge${customer.status === 'ARCHIVED' ? ' sf-status-badge--muted' : ''}`}>{customer.status.toLowerCase()}</span>
      </header>

      {query.status && statuses[query.status] ? <p className="sf-alert sf-alert--success" role="status">{statuses[query.status]}</p> : null}
      {query.error && errors[query.error] ? <p className="sf-alert sf-alert--error" role="alert">{errors[query.error]}</p> : null}

      <div className="sf-customer-detail__grid">
        <section className="sf-customers-card" aria-labelledby="customer-information-title">
          <p className="sf-eyebrow">Profile</p>
          <h2 id="customer-information-title">Customer information</h2>
          <dl className="sf-customer-details">
            <div><dt>Email</dt><dd>{customer.email ? <a href={`mailto:${customer.email}`}>{customer.email}</a> : 'Not provided'}</dd></div>
            <div><dt>Phone</dt><dd>{customer.phone ? <a href={`tel:${customer.phone}`}>{customer.phone}</a> : 'Not provided'}</dd></div>
            <div><dt>Created</dt><dd>{customer.createdAt.toLocaleString()}</dd></div>
            <div><dt>Last updated</dt><dd>{customer.updatedAt.toLocaleString()}</dd></div>
          </dl>
          <div className="sf-customer-notes">
            <strong>Internal notes</strong>
            <p>{customer.notes ?? 'No internal notes saved.'}</p>
          </div>
        </section>

        <section className="sf-customers-card" aria-labelledby="customer-activity-title">
          <p className="sf-eyebrow">History</p>
          <h2 id="customer-activity-title">Activity</h2>
          {detail.activity.length === 0 ? <div className="sf-empty-state"><p>No customer activity has been recorded.</p></div> : (
            <ol className="sf-customer-activity">
              {detail.activity.map((event) => (
                <li key={event.id}>
                  <strong>{activityLabels[event.action] ?? event.action}</strong>
                  <span>{event.actorUser.displayName || event.actorUser.email}</span>
                  <time dateTime={event.createdAt.toISOString()}>{event.createdAt.toLocaleString()}</time>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {canManage && customer.status === 'ACTIVE' ? (
        <section className="sf-customers-card" aria-labelledby="edit-customer-title">
          <p className="sf-eyebrow">Edit</p>
          <h2 id="edit-customer-title">Update customer</h2>
          <form className="sf-form" action={`/api/customers/${customer.id}`} method="post">
            <div className="sf-form-row">
              <label className="sf-field">First name<input name="firstName" defaultValue={customer.firstName} maxLength={80} required autoComplete="given-name" /></label>
              <label className="sf-field">Last name<input name="lastName" defaultValue={customer.lastName} maxLength={80} required autoComplete="family-name" /></label>
            </div>
            <label className="sf-field">Email<input type="email" name="email" defaultValue={customer.email ?? ''} maxLength={320} autoComplete="email" /></label>
            <label className="sf-field">Phone<input type="tel" name="phone" defaultValue={customer.phone ?? ''} maxLength={40} autoComplete="tel" /></label>
            <label className="sf-field">Internal notes<textarea name="notes" defaultValue={customer.notes ?? ''} rows={5} maxLength={5000} /><small>Do not store passwords, payment-card data, or provider secrets.</small></label>
            <button className="sf-button sf-button--primary" type="submit">Save customer</button>
          </form>
        </section>
      ) : null}

      {canManage && customer.status === 'ACTIVE' ? (
        <section className="sf-customer-danger" aria-labelledby="archive-customer-title">
          <div>
            <p className="sf-eyebrow">Lifecycle</p>
            <h2 id="archive-customer-title">Archive customer</h2>
            <p>Archiving removes this record from the active directory while preserving its history. Type <strong>ARCHIVE</strong> to confirm.</p>
          </div>
          <form className="sf-customer-danger__form" action={`/api/customers/${customer.id}/archive`} method="post">
            <label className="sf-field">Confirmation<input name="confirmation" pattern="[Aa][Rr][Cc][Hh][Ii][Vv][Ee]" required autoComplete="off" /></label>
            <button className="sf-button sf-button--danger" type="submit">Archive customer</button>
          </form>
        </section>
      ) : null}

      {customer.status === 'ARCHIVED' ? (
        <section className="sf-customers-card"><p className="sf-eyebrow">Archived</p><h2>Read-only historical record</h2><p>This customer remains available for history and future booking references, but editing is disabled after archival.</p></section>
      ) : null}
    </div>
  );
}
