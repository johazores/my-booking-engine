'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function BookingTaxInvoiceAction({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function issueInvoice() {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/bookings/hospitality/${bookingId}/tax-invoices`, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: '{}',
      });
      const payload = await response.json().catch(() => null) as { documentNumber?: string; message?: string } | null;
      if (!response.ok || !payload?.documentNumber) throw new Error(payload?.message ?? 'Tax invoice issuance failed.');
      router.push(`/invoices/${encodeURIComponent(payload.documentNumber)}`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Tax invoice issuance failed.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!confirming) {
    return <div className="sf-actions"><button className="sf-button" type="button" onClick={() => setConfirming(true)}>Issue Australian tax invoice</button></div>;
  }

  return <div className="sf-empty-state" role="group" aria-labelledby="issue-tax-invoice-title">
    <h3 id="issue-tax-invoice-title">Confirm tax invoice issuance</h3>
    <p>This permanently freezes the current customer, issuer, pricing, GST, and booking evidence and allocates the next tenant tax-invoice number. Existing issued documents are never rewritten.</p>
    {error ? <p role="alert">{error}</p> : null}
    <div className="sf-actions">
      <button className="sf-button" type="button" disabled={submitting} onClick={issueInvoice}>{submitting ? 'Issuing…' : 'Confirm and issue'}</button>
      <button className="sf-button sf-button--secondary" type="button" disabled={submitting} onClick={() => { setConfirming(false); setError(null); }}>Cancel</button>
    </div>
  </div>;
}
