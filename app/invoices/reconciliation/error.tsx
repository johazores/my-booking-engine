'use client';

import Link from 'next/link';

export default function TaxDocumentReconciliationError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="sf-invoice-page sf-invoice-history-page">
    <header className="sf-invoice-history-page__header">
      <div><p className="sf-eyebrow">Legal document controls</p><h1>Tax document reconciliation</h1><p>The reconciliation controls or audit history could not be loaded.</p></div>
      <Link className="sf-button sf-button--secondary" href="/invoices">Back to invoices</Link>
    </header>
    <section className="sf-invoice-history-card" role="alert">
      <div className="sf-invoice-history-empty"><h2>Reconciliation page unavailable</h2><p>No integrity result is inferred from this page failure. Retry the page, or investigate the server error before relying on reconciliation history.</p><button className="sf-button" type="button" onClick={reset}>Retry page</button></div>
    </section>
  </div>;
}
