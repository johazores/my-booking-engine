export default function TaxDocumentReconciliationLoading() {
  return <div className="sf-invoice-page sf-invoice-history-page" aria-busy="true">
    <header className="sf-invoice-history-page__header">
      <div><p className="sf-eyebrow">Legal document controls</p><h1>Tax document reconciliation</h1><p>Verifying the tenant legal-document register…</p></div>
    </header>
    <section className="sf-invoice-history-card" role="status" aria-live="polite">
      <div className="sf-invoice-history-empty"><h2>Checking immutable evidence</h2><p>SF is validating issued tax invoices, adjustment notes, fingerprints, and source-document links.</p></div>
    </section>
  </div>;
}
