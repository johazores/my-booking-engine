'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function CancellationAdjustmentNoteAction({
  bookingId,
  sourceInvoiceDocumentNumber,
  refundTransactionId,
}: {
  bookingId: string;
  sourceInvoiceDocumentNumber: string;
  refundTransactionId: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function issueAdjustmentNote() {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/bookings/hospitality/${encodeURIComponent(bookingId)}/adjustment-notes`, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ sourceInvoiceDocumentNumber, refundTransactionId }),
      });
      const payload = await response.json().catch(() => null) as { documentNumber?: string; message?: string } | null;
      if (!response.ok || !payload?.documentNumber) {
        throw new Error(payload?.message ?? 'Cancellation adjustment-note issuance failed.');
      }
      router.push(`/invoices/adjustments/${encodeURIComponent(payload.documentNumber)}`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Cancellation adjustment-note issuance failed.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!confirming) {
    return <button className="sf-button" type="button" onClick={() => setConfirming(true)}>
      Issue cancellation adjustment note
    </button>;
  }

  return <div className="sf-empty-state" role="group" aria-labelledby="issue-adjustment-note-title">
    <h3 id="issue-adjustment-note-title">Confirm adjustment-note issuance</h3>
    <p>This permanently links the full booking refund to this tax invoice and allocates the next tenant adjustment-note number. The original tax invoice is never rewritten.</p>
    {error ? <p className="sf-booking-modification-form__error" role="alert">{error}</p> : null}
    <div className="sf-actions">
      <button className="sf-button" type="button" disabled={submitting} onClick={issueAdjustmentNote}>
        {submitting ? 'Issuing…' : 'Confirm and issue'}
      </button>
      <button className="sf-button sf-button--secondary" type="button" disabled={submitting} onClick={() => { setConfirming(false); setError(null); }}>
        Cancel
      </button>
    </div>
  </div>;
}
