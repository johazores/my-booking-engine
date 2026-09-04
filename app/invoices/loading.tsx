export default function InvoicesLoading() {
  return <div className="sf-invoice-page"><div className="sf-invoice-loading" role="status" aria-live="polite"><span className="sf-spinner" aria-hidden="true" /><div><strong>Loading tax invoices</strong><p>Verifying tenant access and immutable issued-document evidence.</p></div></div></div>;
}
