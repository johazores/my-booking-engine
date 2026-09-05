import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import type { HospitalityTaxDocumentReconciliationFailureCode } from '@/server/payments/hospitality-tax-document-reconciliation-domain.ts';
import { listHospitalityTaxDocumentReconciliationHistory } from '@/server/payments/hospitality-tax-document-reconciliation-service.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

import { ReconciliationRunForm } from './reconciliation-run-form.tsx';

const PAGE_SIZE = 20;

function pageNumber(value: string | undefined) {
  const page = Number(value ?? '1');
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function failureLabel(code: HospitalityTaxDocumentReconciliationFailureCode) {
  if (code === 'INTEGRITY_CHECK_FAILED') return 'Immutable tax-invoice evidence failed validation.';
  if (code === 'SOURCE_LINK_FAILED') return 'Adjustment-note or source-invoice evidence failed validation.';
  return 'The legal-document register changed while reconciliation was running.';
}

const errorMessages: Record<string, string> = {
  limit: 'The tenant register exceeds the bounded synchronous reconciliation limit. No partial result was recorded as complete.',
  request: 'The reconciliation request was rejected. Refresh this page and try again from the current SF session.',
  internal: 'The reconciliation run could not complete because of a server error. No verification result was recorded. Try again after the service recovers.',
};

export default async function TaxDocumentReconciliationPage({ searchParams }: {
  searchParams: Promise<{ page?: string; status?: string; error?: string }>;
}) {
  const authState = await readAuthSessionState();
  const authRedirect = getAuthRequiredRedirect(authState);
  if (authRedirect) redirect(authRedirect);
  const session = authState.session;
  if (!session) throw new Error('Authenticated tax-document reconciliation guard returned without a session');

  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) redirect('/dashboard?error=tenant');

  const query = await searchParams;
  const requestedPage = pageNumber(query.page);
  let history;
  try {
    history = await listHospitalityTaxDocumentReconciliationHistory({
      organizationId: activeContext.organization.id,
      actorUserId: session.user.id,
      page: requestedPage,
      pageSize: PAGE_SIZE,
    });
  } catch (error) {
    if (error instanceof OrganizationPermissionDeniedError) redirect('/dashboard?error=permission');
    throw error;
  }

  if (history.total > 0 && requestedPage > history.totalPages) redirect(`/invoices/reconciliation?page=${history.totalPages}`);

  return <div className="sf-invoice-page sf-invoice-history-page">
    <header className="sf-invoice-history-page__header">
      <div><p className="sf-eyebrow">Legal document controls</p><h1>Tax document reconciliation</h1><p>Operator-triggered tenant-scoped integrity verification for immutable Australian tax invoices and adjustment notes.</p></div>
      <div className="sf-invoice-toolbar"><Link className="sf-button sf-button--secondary" href="/invoices">Tax invoices</Link><Link className="sf-button sf-button--secondary" href="/invoices/adjustments">Adjustment notes</Link></div>
    </header>

    {query.status === 'verified' ? <p className="sf-alert sf-alert--success" role="status">Reconciliation completed and the bounded register passed all implemented integrity checks.</p> : null}
    {query.status === 'failed' ? <p className="sf-alert sf-alert--error" role="alert">Reconciliation completed with integrity concerns. Review the newest recorded result before using this register for close or investigation.</p> : null}
    {query.error && errorMessages[query.error] ? <p className="sf-alert sf-alert--error" role="alert">{errorMessages[query.error]}</p> : null}

    <section className="sf-invoice-history-card" aria-labelledby="run-reconciliation-title">
      <div className="sf-invoice-history-card__heading"><div><p className="sf-eyebrow">Point-in-time verification</p><h2 id="run-reconciliation-title">Run an integrity check</h2></div><span>AU</span></div>
      <p>Reconciliation is explicit and does not run when this page is opened or refreshed. The bounded scan checks the current tenant register and records only a safe summary of the completed result in audit history.</p>
      <ReconciliationRunForm />
    </section>

    <section className="sf-invoice-history-card" aria-labelledby="reconciliation-history-title">
      <div className="sf-invoice-history-card__heading"><div><p className="sf-eyebrow">Audit history</p><h2 id="reconciliation-history-title">{history.total} reconciliation run{history.total === 1 ? '' : 's'}</h2></div><span>Page {history.page} of {history.totalPages}</span></div>
      {history.items.length === 0 ? <div className="sf-invoice-history-empty"><h3>No reconciliation has been run</h3><p>Run the integrity check when investigating document evidence, after material tax-document migrations, or before a period-close accounting export.</p></div> : <div className="sf-invoice-history-table-wrap"><table className="sf-invoice-history-table"><thead><tr><th scope="col">Checked</th><th scope="col">Status</th><th scope="col">Tax invoices</th><th scope="col">Adjustment notes</th><th scope="col">Issues</th></tr></thead><tbody>{history.items.map(({ id, report }) => <tr key={id}><th scope="row">{report.checkedAt.toLocaleString('en-AU', { timeZone: 'UTC' })} UTC</th><td><span className="sf-status-badge">{report.status.toLowerCase()}</span></td><td>{report.taxInvoiceCount}</td><td>{report.adjustmentNoteCount}</td><td>{report.failureCodes.length === 0 ? 'None' : report.failureCodes.map(failureLabel).join(' ')}</td></tr>)}</tbody></table></div>}
      {history.totalPages > 1 ? <nav className="sf-invoice-history-pagination" aria-label="Tax document reconciliation history pages">{history.page > 1 ? <Link className="sf-button sf-button--secondary" href={`/invoices/reconciliation?page=${history.page - 1}`}>Previous runs</Link> : <span />}{history.page < history.totalPages ? <Link className="sf-button sf-button--secondary" href={`/invoices/reconciliation?page=${history.page + 1}`}>Next runs</Link> : null}</nav> : null}
    </section>

    <section className="sf-invoice-history-card" aria-labelledby="retention-policy-title">
      <div className="sf-invoice-history-card__heading"><div><p className="sf-eyebrow">Retention</p><h2 id="retention-policy-title">No automatic deletion</h2></div><span>AU</span></div>
      <p>SF does not automatically delete or rewrite issued Australian tax invoices or adjustment notes, and it does not infer disposal authority from document age alone.</p>
      <p>A future disposal workflow must be separately reviewed against the applicable tax record period, assessment or review periods, and privacy obligations before legal-document personal information can be removed or de-identified.</p>
    </section>
  </div>;
}
