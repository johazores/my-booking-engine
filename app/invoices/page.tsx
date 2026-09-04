import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import { listHospitalityIssuedTaxInvoicesForOrganization } from '@/server/payments/hospitality-issued-invoice-read-service.ts';
import { moneyMinorToMajorString } from '@/server/pricing/money.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

const PAGE_SIZE = 25;

function money(amountMinor: bigint, currency: string) {
  return `${currency} ${moneyMinorToMajorString(amountMinor, currency)}`;
}

function pageNumber(value: string | undefined) {
  const page = Number(value ?? '1');
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

export default async function InvoiceRegisterPage({ searchParams }: {
  searchParams: Promise<{ page?: string }>;
}) {
  const authState = await readAuthSessionState();
  const authRedirect = getAuthRequiredRedirect(authState);
  if (authRedirect) redirect(authRedirect);
  const session = authState.session;
  if (!session) throw new Error('Authenticated invoice register guard returned without a session');

  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) redirect('/dashboard?error=tenant');
  const page = pageNumber((await searchParams).page);

  let invoices;
  try {
    invoices = await listHospitalityIssuedTaxInvoicesForOrganization({
      organizationId: activeContext.organization.id,
      actorUserId: session.user.id,
      page,
      pageSize: PAGE_SIZE,
    });
  } catch (error) {
    if (error instanceof OrganizationPermissionDeniedError) redirect('/dashboard?error=permission');
    throw error;
  }

  if (invoices.total > 0 && invoices.page > invoices.totalPages) redirect(`/invoices?page=${invoices.totalPages}`);

  return <div className="sf-invoice-page sf-invoice-history-page sf-invoice-register-page">
    <header className="sf-invoice-history-page__header">
      <div><p className="sf-eyebrow">Legal documents</p><h1>Tax invoice register</h1><p>Tenant-scoped immutable Australian tax invoices issued from accepted booking evidence.</p></div>
      <div className="sf-invoice-toolbar">
        <Link className="sf-button sf-button--secondary" href="/invoices/adjustments">Adjustment notes</Link>
        <a className="sf-button sf-button--secondary" href="/api/invoices/hospitality/accounting">Download accounting CSV</a>
      </div>
    </header>

    <section className="sf-invoice-history-card" aria-labelledby="invoice-register-title">
      <div className="sf-invoice-history-card__heading"><div><p className="sf-eyebrow">Issued history</p><h2 id="invoice-register-title">{invoices.total} tax invoice{invoices.total === 1 ? '' : 's'}</h2></div><span>Page {invoices.page} of {invoices.totalPages}</span></div>
      {invoices.items.length === 0 ? <div className="sf-invoice-history-empty"><h3>No tax invoices issued</h3><p>Issued Australian tax invoices will appear here after their immutable preparation passes the production readiness boundary.</p></div> : <div className="sf-invoice-history-table-wrap"><table className="sf-invoice-history-table sf-invoice-register-table"><thead><tr><th scope="col">Invoice</th><th scope="col">Booking</th><th scope="col">Issued</th><th scope="col">Total</th><th scope="col">Document</th></tr></thead><tbody>{invoices.items.map((invoice) => <tr key={invoice.documentNumber}><th scope="row">{invoice.documentNumber}</th><td><Link href={`/bookings/${encodeURIComponent(invoice.bookingId)}`}>View booking</Link></td><td>{invoice.issuedAt.toLocaleDateString('en-AU', { timeZone: 'UTC' })}</td><td>{money(invoice.totalMinor, invoice.currency)}</td><td><Link href={`/invoices/${encodeURIComponent(invoice.documentNumber)}`}>View tax invoice</Link></td></tr>)}</tbody></table></div>}
      {invoices.totalPages > 1 ? <nav className="sf-invoice-history-pagination" aria-label="Tax invoice register pages">{invoices.page > 1 ? <Link className="sf-button sf-button--secondary" href={`/invoices?page=${invoices.page - 1}`}>Previous invoices</Link> : <span />}{invoices.page < invoices.totalPages ? <Link className="sf-button sf-button--secondary" href={`/invoices?page=${invoices.page + 1}`}>Next invoices</Link> : null}</nav> : null}
    </section>
  </div>;
}
