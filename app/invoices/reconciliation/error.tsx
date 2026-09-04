'use client';

import Link from 'next/link';

export default function TaxDocumentReconciliationError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="sf-invoice-page sf-invoice-history-page">
    <header className="sf-invoice-history-page__header">
      <div><p className="sf-eyebrow">Legal document controls</p><h1>Tax document reconciliation</h1><p>The current register could not be verified.</p></div>
      <Link className="sf-button sf-button--secondary" href="/invoices">Back to invoices</Link>
    </header>
    <section className="sf-invoice-history-card" role="alert">
      <div className="sf-invoice-history-empty"><h2>Reconciliation did not complete</h2><p>No partial result is treated as verified. Retry the read-only check, or investigate the server error before using the register as reconciled.</p><button className="sf-button" type="button" onClick={reset}>Retry reconciliation</button></div>
    </section>
  </div>;
}
