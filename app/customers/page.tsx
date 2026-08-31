import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { organizationRoleHasPermission } from '@/server/authorization/authorization-domain.ts';
import { readOrganizationAuthorization } from '@/server/authorization/authorization-service.ts';
import {
  normalizeCustomerSearch,
  parseCustomerPage,
  parseCustomerPageSize,
  parseCustomerSort,
  parseCustomerStatus,
} from '@/server/customers/customer-domain.ts';
import { listCustomers } from '@/server/customers/customer-service.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

const errors: Record<string, string> = {
  tenant: 'Choose an active organization before managing customers.',
  permission: 'You do not have permission to manage customers.',
  email: 'A customer with that email already exists in this organization.',
  validation: 'Check the customer details and try again.',
  server: 'The customer operation could not be completed. Try again.',
};

const statuses: Record<string, string> = {
  archived: 'Customer archived. Historical activity was preserved.',
};

function paginationHref(input: {
  page: number;
  search: string;
  status: string;
  sort: string;
  pageSize: number;
}) {
  const params = new URLSearchParams();
  if (input.search) params.set('q', input.search);
  if (input.status !== 'ACTIVE') params.set('customerStatus', input.status);
  if (input.sort !== 'newest') params.set('sort', input.sort);
  if (input.pageSize !== 20) params.set('pageSize', String(input.pageSize));
  if (input.page > 1) params.set('page', String(input.page));
  const query = params.toString();
  return query ? `/customers?${query}` : '/customers';
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    customerStatus?: string;
    sort?: string;
    page?: string;
    pageSize?: string;
    status?: string;
    error?: string;
  }>;
}) {
  const authState = await readAuthSessionState();
  const authRedirect = getAuthRequiredRedirect(authState);
  if (authRedirect) redirect(authRedirect);
  const session = authState.session;
  if (!session) throw new Error('Authenticated customer guard returned without a session');

  const params = await searchParams;
  const activeContext = await readActiveOrganizationContext(session.user.id);
  const authorization = activeContext.organization
    ? await readOrganizationAuthorization({ organizationId: activeContext.organization.id, userId: session.user.id })
    : null;
  const canRead = Boolean(
    authorization?.platformAdmin ||
    (authorization?.role && organizationRoleHasPermission(authorization.role, 'customer:read')),
  );
  const canManage = Boolean(
    authorization?.platformAdmin ||
    (authorization?.role && organizationRoleHasPermission(authorization.role, 'customer:manage')),
  );

  const search = normalizeCustomerSearch(params.q);
  const customerStatus = parseCustomerStatus(params.customerStatus);
  const sort = parseCustomerSort(params.sort);
  const requestedPage = parseCustomerPage(params.page);
  const pageSize = parseCustomerPageSize(params.pageSize);

  if (!activeContext.organization) {
    return (
      <section className="sf-customers-empty" aria-labelledby="customers-empty-title">
        <p className="sf-eyebrow">Customers</p>
        <h1 id="customers-empty-title">Select an organization first</h1>
        <p>Customer records are tenant-owned. Choose or create an organization before accessing customer data.</p>
        <Link className="sf-button sf-button--primary" href="/account">Choose organization</Link>
      </section>
    );
  }

  if (!canRead) {
    return (
      <section className="sf-customers-empty" aria-labelledby="customers-permission-title">
        <p className="sf-eyebrow">Customers</p>
        <h1 id="customers-permission-title">Customer access is restricted</h1>
        <p>Your organization role does not include customer-directory access.</p>
      </section>
    );
  }

  const result = await listCustomers({
    organizationId: activeContext.organization.id,
    actorUserId: session.user.id,
    search,
    status: customerStatus,
    sort,
    page: requestedPage,
    pageSize,
  });
  const currentPage = result.page;
  const totalPages = result.totalPages;
  const firstResult = result.total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastResult = Math.min(currentPage * pageSize, result.total);

  return (
    <div className="sf-customers-page">
      <header className="sf-customers-page__header">
        <div>
          <p className="sf-eyebrow">Customer operations</p>
          <h1>Customers</h1>
          <p>Tenant-scoped traveler and guest records for {activeContext.organization.name}.</p>
        </div>
        <span className="sf-customers-page__count">{result.total} total</span>
      </header>

      {params.status && statuses[params.status] ? <p className="sf-alert sf-alert--success" role="status">{statuses[params.status]}</p> : null}
      {params.error && errors[params.error] ? <p className="sf-alert sf-alert--error" role="alert">{errors[params.error]}</p> : null}

      <section className="sf-customers-toolbar" aria-label="Customer filters">
        <form className="sf-customers-filter" method="get">
          <label className="sf-field sf-customers-filter__search">Search<input type="search" name="q" defaultValue={search} placeholder="Name, email or phone" maxLength={120} /></label>
          <label className="sf-field">Status<select name="customerStatus" defaultValue={customerStatus}><option value="ACTIVE">Active</option><option value="ARCHIVED">Archived</option><option value="ALL">All</option></select></label>
          <label className="sf-field">Sort<select name="sort" defaultValue={sort}><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="name-asc">Name A–Z</option><option value="name-desc">Name Z–A</option></select></label>
          <label className="sf-field">Per page<select name="pageSize" defaultValue={String(pageSize)}><option value="20">20</option><option value="50">50</option></select></label>
          <button className="sf-button sf-button--secondary" type="submit">Apply filters</button>
          {(search || customerStatus !== 'ACTIVE' || sort !== 'newest' || pageSize !== 20) ? <Link className="sf-button sf-button--secondary" href="/customers">Clear</Link> : null}
        </form>
      </section>

      <div className={`sf-customers-layout${canManage ? '' : ' sf-customers-layout--single'}`}>
        <section className="sf-customers-card" aria-labelledby="customer-list-title">
          <div className="sf-customers-card__heading">
            <div><p className="sf-eyebrow">Directory</p><h2 id="customer-list-title">Customer records</h2></div>
            <span>{firstResult}–{lastResult} of {result.total}</span>
          </div>

          {result.customers.length === 0 ? (
            <div className="sf-empty-state">
              <h3>{search ? 'No matching customers' : customerStatus === 'ARCHIVED' ? 'No archived customers' : 'No customers yet'}</h3>
              <p>{search ? 'Try a broader search or clear the current filters.' : canManage ? 'Create the first customer using the form beside this directory.' : 'No customer records are available for this view.'}</p>
            </div>
          ) : (
            <ul className="sf-customer-list">
              {result.customers.map((customer) => (
                <li key={customer.id}>
                  <Link href={`/customers/${customer.id}`} className="sf-customer-list__link">
                    <div className="sf-customer-list__identity">
                      <strong>{customer.firstName} {customer.lastName}</strong>
                      <span>{customer.email ?? customer.phone ?? 'No contact details'}</span>
                    </div>
                    <div className="sf-customer-list__meta">
                      <span className={`sf-status-badge${customer.status === 'ARCHIVED' ? ' sf-status-badge--muted' : ''}`}>{customer.status.toLowerCase()}</span>
                      <span>Updated {customer.updatedAt.toLocaleDateString()}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {result.total > pageSize ? (
            <nav className="sf-pagination" aria-label="Customer pages">
              {currentPage > 1 ? <Link className="sf-button sf-button--secondary sf-button--compact" href={paginationHref({ page: currentPage - 1, search, status: customerStatus, sort, pageSize })}>Previous</Link> : <span />}
              <span>Page {currentPage} of {totalPages}</span>
              {currentPage < totalPages ? <Link className="sf-button sf-button--secondary sf-button--compact" href={paginationHref({ page: currentPage + 1, search, status: customerStatus, sort, pageSize })}>Next</Link> : <span />}
            </nav>
          ) : null}
        </section>

        {canManage ? (
          <aside className="sf-customers-card sf-customers-card--create" aria-labelledby="create-customer-title">
            <p className="sf-eyebrow">New record</p>
            <h2 id="create-customer-title">Create customer</h2>
            <p>Contact fields are optional, but duplicate customer emails are prevented inside the same tenant.</p>
            <form className="sf-form" action="/api/customers" method="post">
              <div className="sf-form-row">
                <label className="sf-field">First name<input name="firstName" maxLength={80} required autoComplete="given-name" /></label>
                <label className="sf-field">Last name<input name="lastName" maxLength={80} required autoComplete="family-name" /></label>
              </div>
              <label className="sf-field">Email<input type="email" name="email" maxLength={320} autoComplete="email" /></label>
              <label className="sf-field">Phone<input type="tel" name="phone" maxLength={40} autoComplete="tel" /></label>
              <label className="sf-field">Internal notes<textarea name="notes" rows={4} maxLength={5000} /><small>Internal operational context only. Do not store passwords, payment-card data, or provider secrets.</small></label>
              <button className="sf-button sf-button--primary" type="submit">Create customer</button>
            </form>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
