import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import {
  HospitalityTaxDocumentReconciliationLimitError,
  reconcileHospitalityAustralianTaxDocuments,
} from '@/server/payments/hospitality-tax-document-reconciliation-service.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

function failureLabel(code: 'INTEGRITY_CHECK_FAILED' | 'SOURCE_LINK_FAILED' | 'CONCURRENT_CHANGE') {
  if (code === 'INTEGRITY_CHECK_FAILED') return 'At least one immutable tax invoice failed evidence validation.';
  if (code === 'SOURCE_LINK_FAILED') return 'At least one adjustment note or its source tax invoice failed evidence validation.';
  return 'The legal-document register changed while reconciliation was running. Run reconciliation again.';
}

export default async function TaxDocumentReconciliationPage() {
  const authState = await readAuthSessionState();
  const authRedirect = getAuthRequiredRedirect(authState);
  if (authRedirect) redirect(authRedirect);
  const session = authState.session;
  if (!session) throw new Error('Authenticated tax-document reconciliation guard returned without a session');

  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) redirect('/dashboard?error=tenant');

  let report;
  try {
    report = await reconcileHospitalityAustralianTaxDocuments({ organizationId: activeContext.organization.id, actorUserId: session.user.id });
  } catch (error) {
    if (error instanceof OrganizationPermissionDeniedError) redirect('/dashboard?error=permission');
    if (error instanceof HospitalityTaxDocumentReconciliationLimitError) {
      return <div className="sf-invoice-page sf-invoice-history-page">
        <header className="sf-invoice-history-page__header"><div><p className="sf-eyebrow">Legal document controls</p><h1>Tax document reconciliation</h1><p>The tenant register is too large for the bounded synchronous verifier.</p></div><Link className="sf-button sf-button--secondary" href="/invoices">Back to invoices</Link></header>
        <section className="sf-invoice-history-card"><div className="sf-invoice-history-empty"><h2>Reconciliation requires an offline review</h2><p>{error.message} No partial verification result is reported as complete.</p></div></section>
      </div>;
    }
    throw error;
  }

  const verified = report.status === 'VERIFIED';
  return <div className="sf-invoice-page sf-invoice-history-page">
    <header className="sf-invoice-history-page__header">
      <div><p className="sf-eyebrow">Legal document controls</p><h1>Tax document reconciliation</h1><p>Live tenant-scoped integrity verification for immutable Australian tax invoices and adjustment notes.</p></div>
      <div className="sf-invoice-toolbar"><Link className="sf-button sf-button--secondary" href="/invoices">Tax invoices</Link><Link className="sf-button sf-button--secondary" href="/invoices/adjustments">Adjustment notes</Link></div>
    </header>

    <section className="sf-invoice-history-card" aria-labelledby="reconciliation-result-title">
      <div className="sf-invoice-history-card__heading"><div><p className="sf-eyebrow">Point-in-time verification</p><h2 id="reconciliation-result-title">{verified ? 'Register verified' : 'Review required'}</h2></div><span className="sf-status-badge">{report.status.toLowerCase()}</span></div>
      <p>Checked {report.totalDocumentCount} legal document{report.totalDocumentCount === 1 ? '' : 's'}: {report.taxInvoiceCount} tax invoice{report.taxInvoiceCount === 1 ? '' : 's'} and {report.adjustmentNoteCount} adjustment note{report.adjustmentNoteCount === 1 ? '' : 's'}.</p>
      <p>Verification time: {report.checkedAt.toLocaleString('en-AU', { timeZone: 'UTC' })} UTC.</p>
      {verified ? <div className="sf-invoice-history-empty"><h3>Immutable evidence is internally consistent</h3><p>Every document passed its persisted snapshot, material-column and fingerprint checks. Adjustment notes also passed source-tax-invoice linkage validation.</p></div> : <div className="sf-invoice-history-empty"><h3>Do not treat this register as reconciled</h3>{report.failures.map((failure, index) => <p key={`${failure.code}:${index}`} role="alert">{failureLabel(failure.code)}</p>)}</div>}
    </section>

    <section className="sf-invoice-history-card" aria-labelledby="retention-policy-title">
      <div className="sf-invoice-history-card__heading"><div><p className="sf-eyebrow">Retention</p><h2 id="retention-policy-title">No automatic deletion</h2></div><span>AU</span></div>
      <p>SF does not automatically delete or rewrite issued Australian tax invoices or adjustment notes, and it does not infer disposal authority from document age alone.</p>
      <p>A future disposal workflow must be separately reviewed against the applicable tax record period, assessment or review periods, and privacy obligations before legal-document personal information can be removed or de-identified.</p>
    </section>
  </div>;
}
