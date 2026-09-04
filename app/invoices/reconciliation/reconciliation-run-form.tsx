'use client';

import { useState } from 'react';

export function ReconciliationRunForm() {
  const [submitting, setSubmitting] = useState(false);

  return <form className="sf-invoice-toolbar" action="/invoices/reconciliation/run" method="post" onSubmit={() => setSubmitting(true)}>
    <button className="sf-button sf-button--primary" type="submit" disabled={submitting} aria-disabled={submitting}>
      {submitting ? 'Running reconciliation…' : 'Run reconciliation'}
    </button>
    <span aria-live="polite">{submitting ? 'Checking the complete bounded legal-document register.' : ''}</span>
  </form>;
}
