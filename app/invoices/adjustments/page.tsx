import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import { listHospitalityIssuedCancellationAdjustmentNotesForOrganization } from '@/server/payments/hospitality-issued-adjustment-note-read-service.ts';
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

export default async function AdjustmentNoteRegisterPage({ searchParams }: {
  searchParams: Promise<{ page?: string }>;
}) {
  const authState = await readAuthSessionState();
  const authRedirect = getAuthRequiredRedirect(authState);
  if (authRedirect) redirect(authRedirect);
  const session = authState.session;
  if (!session) throw new Error('Authenticated adjustment-note register guard returned without a session');

  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) redirect('/dashboard?error=tenant');
  const page = pageNumber((await searchParams).page);

  let notes;
  try {
    notes = await listHospitalityIssuedCancellationAdjustmentNotesForOrganization({
      organizationId: activeContext.organization.id,
      actorUserId: session.user.id,
      page,
      pageSize: PAGE_SIZE,
    });
  } catch (error) {
    if (error instanceof OrganizationPermissionDeniedError) redirect('/dashboard?error=permission');
    throw error;
  }

  if (notes.total > 0 && notes.page > notes.totalPages) redirect(`/invoices/adjustments?page=${notes.totalPages}`);

  return <div className="sf-invoice-page sf-invoice-history-page sf-invoice-register-page">
    <header className="sf-invoice-history-page__header">
      <div><p className="sf-eyebrow">Legal documents</p><h1>Adjustment note register</h1><p>Tenant-scoped immutable Australian decreasing adjustments linked to verified source tax invoices.</p></div>
      <div className="sf-invoice-toolbar">
        <Link className="sf-button sf-button--secondary" href="/invoices">Tax invoices</Link>
        <a className="sf-button sf-button--secondary" href="/api/invoices/hospitality/adjustments/accounting">Download accounting CSV</a>
      </div>
    </header>

    <section className="sf-invoice-history-card" aria-labelledby="adjustment-register-title">
      <div className="sf-invoice-history-card__heading"><div><p className="sf-eyebrow">Issued history</p><h2 id="adjustment-register-title">{notes.total} adjustment note{notes.total === 1 ? '' : 's'}</h2></div><span>Page {notes.page} of {notes.totalPages}</span></div>
      {notes.items.length === 0 ? <div className="sf-invoice-history-empty"><h3>No adjustment notes issued</h3><p>Verified Australian cancellation adjustment notes will appear here after an issued tax invoice receives the supported full-refund adjustment.</p></div> : <div className="sf-invoice-history-table-wrap"><table className="sf-invoice-history-table sf-invoice-register-table"><thead><tr><th scope="col">Adjustment note</th><th scope="col">Source invoice</th><th scope="col">Booking</th><th scope="col">Issued</th><th scope="col">Decrease</th><th scope="col">Document</th></tr></thead><tbody>{notes.items.map((note) => <tr key={note.documentNumber}><th scope="row">{note.documentNumber}</th><td><Link href={`/invoices/${encodeURIComponent(note.sourceTaxInvoiceNumber)}`}>{note.sourceTaxInvoiceNumber}</Link></td><td><Link href={`/bookings/${encodeURIComponent(note.bookingId)}`}>View booking</Link></td><td>{note.issuedAt.toLocaleDateString('en-AU', { timeZone: 'UTC' })}</td><td>{money(note.decreaseTotalMinor, note.currency)}</td><td><Link href={`/invoices/adjustments/${encodeURIComponent(note.documentNumber)}`}>View adjustment note</Link></td></tr>)}</tbody></table></div>}
      {notes.totalPages > 1 ? <nav className="sf-invoice-history-pagination" aria-label="Adjustment note register pages">{notes.page > 1 ? <Link className="sf-button sf-button--secondary" href={`/invoices/adjustments?page=${notes.page - 1}`}>Previous notes</Link> : <span />}{notes.page < notes.totalPages ? <Link className="sf-button sf-button--secondary" href={`/invoices/adjustments?page=${notes.page + 1}`}>Next notes</Link> : null}</nav> : null}
    </section>
  </div>;
}
