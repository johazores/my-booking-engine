import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import {
  HospitalityIssuedInvoiceUnavailableError,
  listHospitalityIssuedTaxInvoices,
} from '@/server/payments/hospitality-issued-invoice-read-service.ts';
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

export default async function BookingInvoiceHistoryPage({ params, searchParams }: {
  params: Promise<{ 'booking-id': string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const authState = await readAuthSessionState();
  const authRedirect = getAuthRequiredRedirect(authState);
  if (authRedirect) redirect(authRedirect);
  const session = authState.session;
  if (!session) throw new Error('Authenticated invoice history guard returned without a session');

  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) redirect('/dashboard?error=tenant');

  const bookingId = (await params)['booking-id'];
  const page = pageNumber((await searchParams).page);

  let invoices;
  try {
    invoices = await listHospitalityIssuedTaxInvoices({
      organizationId: activeContext.organization.id,
      actorUserId: session.user.id,
      bookingId,
      page,
      pageSize: PAGE_SIZE,
    });
  } catch (error) {
    if (error instanceof HospitalityIssuedInvoiceUnavailableError) notFound();
    if (error instanceof OrganizationPermissionDeniedError) redirect('/dashboard?error=permission');
    throw error;
  }

  if (invoices.total > 0 && invoices.page > invoices.totalPages) {
    redirect(`/invoices/booking/${encodeURIComponent(bookingId)}?page=${invoices.totalPages}`);
  }

  return <div className="sf-invoice-page sf-invoice-history-page">
    <header className="sf-invoice-history-page__header">
      <div><p className="sf-eyebrow">Legal documents</p><h1>Australian tax invoices</h1><p>Immutable issued-document history for this booking.</p></div>
      <Link className="sf-button sf-button--secondary" href={`/bookings/${encodeURIComponent(bookingId)}`}>Back to booking</Link>
    </header>

    <section className="sf-invoice-history-card" aria-labelledby="invoice-history-title">
      <div className="sf-invoice-history-card__heading"><div><p className="sf-eyebrow">Issued history</p><h2 id="invoice-history-title">{invoices.total} tax invoice{invoices.total === 1 ? '' : 's'}</h2></div><span>Page {invoices.page} of {invoices.totalPages}</span></div>
      {invoices.items.length === 0 ? <div className="sf-invoice-history-empty"><h3>No tax invoices issued</h3><p>This booking has no immutable Australian tax invoices yet.</p></div> : <div className="sf-invoice-history-table-wrap"><table className="sf-invoice-history-table"><thead><tr><th scope="col">Invoice</th><th scope="col">Issued</th><th scope="col">Total</th><th scope="col">Document</th></tr></thead><tbody>{invoices.items.map((invoice) => <tr key={invoice.documentNumber}><th scope="row">{invoice.documentNumber}</th><td>{invoice.issuedAt.toLocaleDateString('en-AU', { timeZone: 'UTC' })}</td><td>{money(invoice.totalMinor, invoice.currency)}</td><td><Link href={`/invoices/${encodeURIComponent(invoice.documentNumber)}`}>View tax invoice</Link></td></tr>)}</tbody></table></div>}
      {invoices.totalPages > 1 ? <nav className="sf-invoice-history-pagination" aria-label="Tax invoice history pages">{invoices.page > 1 ? <Link className="sf-button sf-button--secondary" href={`/invoices/booking/${encodeURIComponent(bookingId)}?page=${invoices.page - 1}`}>Previous invoices</Link> : <span />}{invoices.page < invoices.totalPages ? <Link className="sf-button sf-button--secondary" href={`/invoices/booking/${encodeURIComponent(bookingId)}?page=${invoices.page + 1}`}>Next invoices</Link> : null}</nav> : null}
    </section>
  </div>;
}
