'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { appendRequestReference } from '@/lib/request-correlation.ts';

export function BookingTaxInvoiceAction({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [recipientType, setRecipientType] = useState<'INDIVIDUAL' | 'BUSINESS'>('INDIVIDUAL');
  const [businessName, setBusinessName] = useState('');
  const [businessAbn, setBusinessAbn] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function issueInvoice() {
    setSubmitting(true);
    setError(null);
    try {
      const recipient = recipientType === 'BUSINESS'
        ? {
            recipientType: 'BUSINESS' as const,
            legalName: businessName,
            registrations: [{ scheme: 'ABN', identifier: businessAbn, countryCode: 'AU' }],
          }
        : undefined;
      const response = await fetch(`/api/bookings/hospitality/${bookingId}/tax-invoices`, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(recipient ? { recipient } : {}),
      });
      const payload = await response.json().catch(() => null) as { documentNumber?: string; message?: string } | null;
      if (!response.ok || !payload?.documentNumber) {
        throw new Error(appendRequestReference(payload?.message ?? 'Tax invoice issuance failed.', response));
      }
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

  const businessReady = recipientType !== 'BUSINESS' || (businessName.trim().length > 0 && businessAbn.trim().length > 0);

  return <div className="sf-empty-state sf-booking-invoice-issuance" role="group" aria-labelledby="issue-tax-invoice-title">
    <h3 id="issue-tax-invoice-title">Confirm tax invoice issuance</h3>
    <p>This permanently freezes the selected recipient, issuer, pricing, GST, and booking evidence and allocates the next tenant tax-invoice number. Existing issued documents are never rewritten.</p>
    <fieldset className="sf-booking-invoice-recipient">
      <legend>Invoice recipient</legend>
      <label className="sf-booking-invoice-recipient__choice">
        <input type="radio" name="invoice-recipient-type" value="INDIVIDUAL" checked={recipientType === 'INDIVIDUAL'} disabled={submitting} onChange={() => setRecipientType('INDIVIDUAL')} />
        <span><strong>Booking customer</strong><small>Use the customer name and email already stored on this booking.</small></span>
      </label>
      <label className="sf-booking-invoice-recipient__choice">
        <input type="radio" name="invoice-recipient-type" value="BUSINESS" checked={recipientType === 'BUSINESS'} disabled={submitting} onChange={() => setRecipientType('BUSINESS')} />
        <span><strong>Australian business</strong><small>Freeze a business legal name and ABN on the issued document.</small></span>
      </label>
      {recipientType === 'BUSINESS' ? <div className="sf-booking-invoice-recipient__business">
        <label><span>Business legal name</span><input value={businessName} onChange={(event) => setBusinessName(event.target.value)} autoComplete="organization" maxLength={200} disabled={submitting} required /></label>
        <label><span>ABN</span><input value={businessAbn} onChange={(event) => setBusinessAbn(event.target.value)} inputMode="numeric" autoComplete="off" maxLength={20} placeholder="11 digits" disabled={submitting} required /></label>
        <p>The server validates the ABN checksum and Australian invoice rules before any number is allocated.</p>
      </div> : null}
    </fieldset>
    {error ? <p className="sf-booking-modification-form__error" role="alert">{error}</p> : null}
    <div className="sf-actions">
      <button className="sf-button" type="button" disabled={submitting || !businessReady} onClick={issueInvoice}>{submitting ? 'Issuing…' : 'Confirm and issue'}</button>
      <button className="sf-button sf-button--secondary" type="button" disabled={submitting} onClick={() => { setConfirming(false); setError(null); }}>Cancel</button>
    </div>
  </div>;
}
