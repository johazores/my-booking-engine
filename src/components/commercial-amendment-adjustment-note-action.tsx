'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function CommercialAmendmentAdjustmentNoteAction({
  bookingId,
  commercialAmendmentId,
  sourceInvoiceDocumentNumber,
  sourceAdjustmentOrdinal,
  adjustmentType,
}: {
  bookingId: string;
  commercialAmendmentId: string;
  sourceInvoiceDocumentNumber: string;
  sourceAdjustmentOrdinal: number;
  adjustmentType: 'DECREASING' | 'INCREASING';
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const increasing = adjustmentType === 'INCREASING';
  const repeated = adjustmentType === 'DECREASING' && sourceAdjustmentOrdinal > 1;

  async function issueAdjustmentNote() {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/bookings/hospitality/${encodeURIComponent(bookingId)}/commercial-amendments/${encodeURIComponent(commercialAmendmentId)}/adjustment-note`,
        {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify({ sourceInvoiceDocumentNumber }),
        },
      );
      const payload = await response.json().catch(() => null) as { documentNumber?: string; message?: string } | null;
      if (!response.ok || !payload?.documentNumber) {
        throw new Error(payload?.message ?? 'Commercial-amendment adjustment-note issuance failed.');
      }
      router.push(`/invoices/adjustments/${encodeURIComponent(payload.documentNumber)}`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Commercial-amendment adjustment-note issuance failed.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!confirming) {
    return <button className="sf-button" type="button" onClick={() => setConfirming(true)}>
      {increasing
        ? 'Issue increase adjustment note'
        : repeated
          ? 'Issue next amendment adjustment note'
          : 'Issue amendment adjustment note'}
    </button>;
  }

  return <div className="sf-empty-state" role="group" aria-labelledby="issue-commercial-adjustment-note-title">
    <h3 id="issue-commercial-adjustment-note-title">Confirm adjustment-note issuance</h3>
    <p>
      {increasing
        ? 'This permanently binds the applied price increase and its immutable pricing evidence to this tax invoice, then allocates the next tenant adjustment-note number. The original tax invoice is never rewritten.'
        : 'This permanently binds the applied price decrease and its immutable pricing evidence to this tax invoice, then allocates the next tenant adjustment-note number. The original tax invoice is never rewritten.'}
    </p>
    {repeated ? <p>
      This will become adjustment {sourceAdjustmentOrdinal} in the verified legal-document chain for the source tax invoice.
    </p> : null}
    {error ? <p className="sf-booking-modification-form__error" role="alert">{error}</p> : null}
    <div className="sf-actions">
      <button className="sf-button" type="button" disabled={submitting} onClick={issueAdjustmentNote}>
        {submitting ? 'Issuing…' : 'Confirm and issue'}
      </button>
      <button
        className="sf-button sf-button--secondary"
        type="button"
        disabled={submitting}
        onClick={() => { setConfirming(false); setError(null); }}
      >
        Cancel
      </button>
    </div>
  </div>;
}
