export default function TaxDocumentReconciliationLoading() {
  return <div className="sf-invoice-page sf-invoice-history-page" aria-busy="true">
    <header className="sf-invoice-history-page__header">
      <div><p className="sf-eyebrow">Legal document controls</p><h1>Tax document reconciliation</h1><p>Loading reconciliation controls and audit history…</p></div>
    </header>
    <section className="sf-invoice-history-card" role="status" aria-live="polite">
      <div className="sf-invoice-history-empty"><h2>Loading reconciliation history</h2><p>No legal-document integrity scan runs until an authorized operator explicitly starts one.</p></div>
    </section>
  </div>;
}
