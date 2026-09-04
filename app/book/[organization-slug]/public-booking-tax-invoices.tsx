'use client';

import { useCallback, useEffect, useState } from 'react';

import { readPublicBookingDocumentCapability } from './public-booking-document-capability.ts';

type InvoiceParty = {
  legalName: string;
  email?: string | null;
  contactEmail?: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string | null;
};

type PublicTaxInvoice = {
  documentTitle: 'Tax invoice';
  documentNumber: string;
  issuedAt: string;
  currency: string;
  seller: InvoiceParty;
  buyer: InvoiceParty;
  supplierAbn: string;
  buyerAbn: string | null;
  taxableSaleStatement: string;
  lines: Array<{ description: string; quantity: number; amountMinor: string }>;
  subtotalBeforeGstMinor: string;
  gstMinor: string;
  totalMinor: string;
};

type PublicAdjustmentNote = {
  documentTitle: 'Adjustment note';
  documentNumber: string;
  issuedAt: string;
  currency: string;
  sourceTaxInvoiceNumber: string;
  sourceTaxInvoiceIssuedAt: string;
  seller: InvoiceParty;
  buyer: InvoiceParty;
  supplierAbn: string;
  adjustmentType: 'Decreasing adjustment';
  adjustmentReason: 'Booking cancellation';
  decreaseSubtotalMinor: string;
  decreaseGstMinor: string;
  decreaseTotalMinor: string;
};

type InvoiceHistory = {
  total: number;
  truncated: boolean;
  items: PublicTaxInvoice[];
  adjustmentNotes?: {
    total: number;
    truncated: boolean;
    items: PublicAdjustmentNote[];
  };
};

function formatMinor(amountMinor: string, currency: string) {
  const fractionDigits = new Intl.NumberFormat(undefined, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  const scale = 10n ** BigInt(fractionDigits);
  const minor = BigInt(amountMinor);
  const whole = minor / scale;
  const fraction = minor % scale;
  return fractionDigits === 0
    ? `${currency} ${whole.toString()}`
    : `${currency} ${whole.toString()}.${fraction.toString().padStart(fractionDigits, '0')}`;
}

function addressLines(party: InvoiceParty) {
  const locality = [party.city, party.region, party.postalCode].filter(Boolean).join(' ');
  return [party.addressLine1, party.addressLine2, locality || null, party.countryCode].filter((line): line is string => Boolean(line));
}

function printInvoice(button: HTMLButtonElement) {
  const invoice = button.closest('.sf-public-invoice');
  if (!(invoice instanceof HTMLElement)) return;

  document.body.classList.add('sf-public-tax-invoice-printing');
  invoice.classList.add('sf-public-invoice--print');
  try {
    window.print();
  } finally {
    invoice.classList.remove('sf-public-invoice--print');
    document.body.classList.remove('sf-public-tax-invoice-printing');
  }
}

export function PublicBookingTaxInvoices({ organizationSlug }: { organizationSlug: string }) {
  const [history, setHistory] = useState<InvoiceHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloadingDocumentNumber, setDownloadingDocumentNumber] = useState<string | null>(null);

  const loadInvoices = useCallback(async () => {
    const bookingCapability = readPublicBookingDocumentCapability(organizationSlug);
    if (!bookingCapability) return;

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/public-bookings/${encodeURIComponent(organizationSlug)}/hospitality/tax-invoices`, {
        method: 'POST',
        headers: { 'accept': 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ bookingCapability }),
      });
      if (response.status === 404) {
        setHistory(null);
        return;
      }
      if (!response.ok) {
        setError('Issued tax documents could not be verified right now.');
        return;
      }
      const data = await response.json() as InvoiceHistory;
      setHistory(data);
    } catch {
      setError('Issued tax documents could not be loaded right now.');
    } finally {
      setBusy(false);
    }
  }, [organizationSlug]);

  const downloadPdf = useCallback(async (documentNumber: string) => {
    const bookingCapability = readPublicBookingDocumentCapability(organizationSlug);
    if (!bookingCapability || downloadingDocumentNumber) return;

    setDownloadingDocumentNumber(documentNumber);
    setError(null);
    try {
      const response = await fetch(
        `/api/public-bookings/${encodeURIComponent(organizationSlug)}/hospitality/tax-invoices/${encodeURIComponent(documentNumber)}/pdf`,
        {
          method: 'POST',
          headers: { 'accept': 'application/pdf', 'content-type': 'application/json' },
          body: JSON.stringify({ bookingCapability }),
        },
      );
      if (!response.ok) {
        setError(response.status === 422
          ? 'This tax invoice contains text that cannot be represented losslessly in the current PDF format. You can still print the verified document.'
          : 'The PDF copy could not be prepared right now.');
        return;
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `${documentNumber}.pdf`;
      anchor.style.display = 'none';
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      setError('The PDF copy could not be downloaded right now.');
    } finally {
      setDownloadingDocumentNumber(null);
    }
  }, [downloadingDocumentNumber, organizationSlug]);

  useEffect(() => {
    void loadInvoices();
  }, [loadInvoices]);

  const hasInvoices = Boolean(history?.items.length);
  const hasAdjustmentNotes = Boolean(history?.adjustmentNotes?.items.length);
  if (!hasInvoices && !hasAdjustmentNotes && !error) return null;

  return (
    <section className="sf-public-booking__search-card sf-public-invoice-history" aria-labelledby="tax-invoice-history-title">
      <div className="sf-public-booking__section-heading">
        <div>
          <p className="sf-public-booking__eyebrow">Issued documents</p>
          <h2 id="tax-invoice-history-title">Australian tax documents</h2>
        </div>
        {history ? <span>{history.total + (history.adjustmentNotes?.total ?? 0)} issued</span> : null}
      </div>

      {error ? <p className="sf-public-booking__alert" role="alert">{error}</p> : null}
      {history?.truncated ? <p className="sf-public-booking__notice">Showing the 50 most recent issued tax invoices for this booking.</p> : null}

      {history?.items.map((invoice, index) => {
        const sellerAddress = addressLines(invoice.seller);
        const buyerAddress = addressLines(invoice.buyer);
        const issuedDate = new Date(invoice.issuedAt).toLocaleDateString('en-AU', { timeZone: 'UTC' });
        const downloading = downloadingDocumentNumber === invoice.documentNumber;
        return (
          <details className="sf-public-invoice" key={invoice.documentNumber} open={index === 0 ? true : undefined}>
            <summary className="sf-public-invoice__summary">
              <span><strong>{invoice.documentNumber}</strong><small>Tax invoice · issued {issuedDate}</small></span>
              <strong>{formatMinor(invoice.totalMinor, invoice.currency)}</strong>
            </summary>
            <div className="sf-public-invoice__body">
              <header className="sf-public-invoice__document-heading">
                <div><p className="sf-public-booking__eyebrow">{invoice.documentTitle}</p><h3>{invoice.documentNumber}</h3></div>
                <p><span>Issued</span><strong>{issuedDate}</strong></p>
              </header>

              <div className="sf-public-invoice__parties">
                <section aria-label="Tax invoice seller">
                  <h3>Seller</h3><p><strong>{invoice.seller.legalName}</strong></p><p>ABN {invoice.supplierAbn}</p>
                  {sellerAddress.map((line, lineIndex) => <p key={`seller:${lineIndex}`}>{line}</p>)}
                  {invoice.seller.contactEmail ? <p>{invoice.seller.contactEmail}</p> : null}
                </section>
                <section aria-label="Tax invoice buyer">
                  <h3>Buyer</h3><p><strong>{invoice.buyer.legalName}</strong></p>
                  {invoice.buyerAbn ? <p>ABN {invoice.buyerAbn}</p> : null}
                  {buyerAddress.map((line, lineIndex) => <p key={`buyer:${lineIndex}`}>{line}</p>)}
                  {invoice.buyer.email ? <p>{invoice.buyer.email}</p> : null}
                </section>
              </div>

              <div className="sf-public-invoice__table-wrap">
                <table className="sf-public-invoice__table">
                  <thead><tr><th scope="col">Supply</th><th scope="col">Quantity</th><th scope="col">Amount excl. GST</th></tr></thead>
                  <tbody>{invoice.lines.map((line, lineIndex) => (
                    <tr key={`${line.description}:${lineIndex}`}><th scope="row">{line.description}</th><td>{line.quantity}</td><td>{formatMinor(line.amountMinor, invoice.currency)}</td></tr>
                  ))}</tbody>
                </table>
              </div>

              <dl className="sf-public-invoice__totals">
                <div><dt>Subtotal excl. GST</dt><dd>{formatMinor(invoice.subtotalBeforeGstMinor, invoice.currency)}</dd></div>
                <div><dt>GST</dt><dd>{formatMinor(invoice.gstMinor, invoice.currency)}</dd></div>
                <div className="sf-public-invoice__total"><dt>Total incl. GST</dt><dd>{formatMinor(invoice.totalMinor, invoice.currency)}</dd></div>
              </dl>
              <p className="sf-public-booking__contact-note">{invoice.taxableSaleStatement}</p>
              <div className="sf-public-invoice__actions">
                <button type="button" className="sf-public-invoice__print-button" onClick={() => void downloadPdf(invoice.documentNumber)} disabled={Boolean(downloadingDocumentNumber)} aria-busy={downloading || undefined}>
                  {downloading ? 'Preparing PDF…' : 'Download PDF'}
                </button>
                <button type="button" className="sf-public-invoice__print-button" onClick={(event) => printInvoice(event.currentTarget)} disabled={Boolean(downloadingDocumentNumber)}>
                  Print or save copy
                </button>
              </div>
            </div>
          </details>
        );
      })}

      {history?.adjustmentNotes?.truncated ? <p className="sf-public-booking__notice">Showing the 50 most recent issued adjustment notes for this booking.</p> : null}
      {history?.adjustmentNotes?.items.map((note) => {
        const sellerAddress = addressLines(note.seller);
        const buyerAddress = addressLines(note.buyer);
        const issuedDate = new Date(note.issuedAt).toLocaleDateString('en-AU', { timeZone: 'UTC' });
        const sourceDate = new Date(note.sourceTaxInvoiceIssuedAt).toLocaleDateString('en-AU', { timeZone: 'UTC' });
        return (
          <details className="sf-public-invoice" key={note.documentNumber}>
            <summary className="sf-public-invoice__summary">
              <span><strong>{note.documentNumber}</strong><small>Adjustment note · issued {issuedDate}</small></span>
              <strong>−{formatMinor(note.decreaseTotalMinor, note.currency)}</strong>
            </summary>
            <div className="sf-public-invoice__body">
              <header className="sf-public-invoice__document-heading">
                <div><p className="sf-public-booking__eyebrow">{note.documentTitle}</p><h3>{note.documentNumber}</h3></div>
                <p><span>Issued</span><strong>{issuedDate}</strong></p>
              </header>

              <div className="sf-public-invoice__parties">
                <section aria-label="Adjustment note seller">
                  <h3>Seller</h3><p><strong>{note.seller.legalName}</strong></p><p>ABN {note.supplierAbn}</p>
                  {sellerAddress.map((line, lineIndex) => <p key={`seller:${lineIndex}`}>{line}</p>)}
                  {note.seller.contactEmail ? <p>{note.seller.contactEmail}</p> : null}
                </section>
                <section aria-label="Adjustment note buyer">
                  <h3>Buyer</h3><p><strong>{note.buyer.legalName}</strong></p>
                  {buyerAddress.map((line, lineIndex) => <p key={`buyer:${lineIndex}`}>{line}</p>)}
                  {note.buyer.email ? <p>{note.buyer.email}</p> : null}
                </section>
              </div>

              <dl className="sf-public-invoice__totals">
                <div><dt>Adjustment type</dt><dd>{note.adjustmentType}</dd></div>
                <div><dt>Reason</dt><dd>{note.adjustmentReason}</dd></div>
                <div><dt>Original tax invoice</dt><dd>{note.sourceTaxInvoiceNumber}</dd></div>
                <div><dt>Original invoice date</dt><dd>{sourceDate}</dd></div>
                <div><dt>Decrease excl. GST</dt><dd>{formatMinor(note.decreaseSubtotalMinor, note.currency)}</dd></div>
                <div><dt>GST decrease</dt><dd>{formatMinor(note.decreaseGstMinor, note.currency)}</dd></div>
                <div className="sf-public-invoice__total"><dt>Total decrease incl. GST</dt><dd>{formatMinor(note.decreaseTotalMinor, note.currency)}</dd></div>
              </dl>
              <p className="sf-public-booking__contact-note">This decreasing adjustment records the full cancellation and refund of the taxable sale shown on the original tax invoice. The original tax invoice remains unchanged.</p>
              <div className="sf-public-invoice__actions">
                <button type="button" className="sf-public-invoice__print-button" onClick={(event) => printInvoice(event.currentTarget)} disabled={Boolean(downloadingDocumentNumber)}>
                  Print or save copy
                </button>
              </div>
            </div>
          </details>
        );
      })}

      {hasInvoices || hasAdjustmentNotes ? (
        <button type="button" className="sf-public-booking__contact" onClick={loadInvoices} disabled={busy || Boolean(downloadingDocumentNumber)}>
          {busy ? 'Refreshing…' : 'Refresh tax documents'}
        </button>
      ) : null}
    </section>
  );
}