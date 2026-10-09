'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { readPublicBookingDocumentCapability, usePublicBookingDocumentCapability } from './public-booking-document-capability.ts';

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
  adjustmentType: 'Decreasing adjustment' | 'Increasing adjustment';
  adjustmentReason: 'Booking cancellation' | 'Commercial booking amendment';
  priceBeforeAdjustmentMinor: string;
  priceAfterAdjustmentMinor: string;
  decreaseSubtotalMinor: string;
  decreaseGstMinor: string;
  decreaseTotalMinor: string;
  increaseSubtotalMinor: string;
  increaseGstMinor: string;
  increaseTotalMinor: string;
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

type DownloadDocumentKind = 'tax-invoice' | 'adjustment-note';

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

function downloadPath(organizationSlug: string, documentNumber: string, kind: DownloadDocumentKind) {
  const collection = kind === 'tax-invoice' ? 'tax-invoices' : 'adjustment-notes';
  return `/api/public-bookings/${encodeURIComponent(organizationSlug)}/hospitality/${collection}/${encodeURIComponent(documentNumber)}/pdf`;
}

function downloadLabel(kind: DownloadDocumentKind) {
  return kind === 'tax-invoice' ? 'tax invoice' : 'adjustment note';
}

function adjustmentNoteStatement(note: PublicAdjustmentNote) {
  if (note.adjustmentReason === 'Booking cancellation') {
    return 'This decreasing adjustment records the full cancellation and refund of the taxable sale shown on the original tax invoice. The original tax invoice remains unchanged.';
  }
  return note.adjustmentType === 'Increasing adjustment'
    ? 'This increasing adjustment records the applied commercial booking amendment against the taxable sale shown on the original tax invoice. The original tax invoice remains unchanged.'
    : 'This decreasing adjustment records the applied commercial booking amendment against the taxable sale shown on the original tax invoice. The original tax invoice remains unchanged.';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isMinor(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value);
}

function isDate(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z)?$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function isParty(value: unknown): value is InvoiceParty {
  if (!isRecord(value) || typeof value.legalName !== 'string') return false;
  return ['addressLine1', 'addressLine2', 'city', 'region', 'postalCode', 'countryCode']
    .every((key) => value[key] === null || typeof value[key] === 'string')
    && ['email', 'contactEmail'].every((key) => value[key] === undefined || value[key] === null || typeof value[key] === 'string');
}

function isTaxInvoice(value: unknown): value is PublicTaxInvoice {
  if (!isRecord(value)) return false;
  return value.documentTitle === 'Tax invoice'
    && typeof value.documentNumber === 'string' && value.documentNumber.length > 0
    && isDate(value.issuedAt)
    && typeof value.currency === 'string' && /^[A-Z]{3}$/.test(value.currency)
    && isParty(value.seller) && isParty(value.buyer)
    && typeof value.supplierAbn === 'string'
    && (value.buyerAbn === null || typeof value.buyerAbn === 'string')
    && typeof value.taxableSaleStatement === 'string'
    && ['subtotalBeforeGstMinor', 'gstMinor', 'totalMinor'].every((key) => isMinor(value[key]))
    && Array.isArray(value.lines)
    && value.lines.every((line: unknown) => isRecord(line)
      && typeof line.description === 'string'
      && typeof line.quantity === 'number' && Number.isSafeInteger(line.quantity) && line.quantity > 0
      && isMinor(line.amountMinor));
}

function isAdjustmentNote(value: unknown): value is PublicAdjustmentNote {
  if (!isRecord(value)) return false;
  return value.documentTitle === 'Adjustment note'
    && typeof value.documentNumber === 'string' && value.documentNumber.length > 0
    && isDate(value.issuedAt) && isDate(value.sourceTaxInvoiceIssuedAt)
    && typeof value.currency === 'string' && /^[A-Z]{3}$/.test(value.currency)
    && typeof value.sourceTaxInvoiceNumber === 'string'
    && isParty(value.seller) && isParty(value.buyer)
    && typeof value.supplierAbn === 'string'
    && (value.adjustmentType === 'Decreasing adjustment' || value.adjustmentType === 'Increasing adjustment')
    && (value.adjustmentReason === 'Booking cancellation' || value.adjustmentReason === 'Commercial booking amendment')
    && (value.adjustmentReason !== 'Booking cancellation' || value.adjustmentType === 'Decreasing adjustment')
    && ['priceBeforeAdjustmentMinor', 'priceAfterAdjustmentMinor', 'decreaseSubtotalMinor',
      'decreaseGstMinor', 'decreaseTotalMinor', 'increaseSubtotalMinor', 'increaseGstMinor',
      'increaseTotalMinor'].every((key) => isMinor(value[key]));
}

function isInvoiceHistory(value: unknown): value is InvoiceHistory {
  if (!isRecord(value)) return false;
  if (typeof value.total !== 'number' || !Number.isSafeInteger(value.total) || value.total < 0
    || typeof value.truncated !== 'boolean' || !Array.isArray(value.items)
    || value.total < value.items.length
    || !value.items.every(isTaxInvoice)) return false;
  if (value.adjustmentNotes === undefined) return true;
  const notes = value.adjustmentNotes;
  return isRecord(notes)
    && typeof notes.total === 'number' && Number.isSafeInteger(notes.total) && notes.total >= 0
    && typeof notes.truncated === 'boolean'
    && Array.isArray(notes.items) && notes.total >= notes.items.length
    && notes.items.every(isAdjustmentNote);
}

export function PublicBookingTaxInvoices({ organizationSlug }: { organizationSlug: string }) {
  const bookingCapability = usePublicBookingDocumentCapability(organizationSlug);
  const [historyState, setHistoryState] = useState<{ capability: string; value: InvoiceHistory } | null>(null);
  const [errorState, setErrorState] = useState<{ capability: string; message: string } | null>(null);
  const [busyCapability, setBusyCapability] = useState<string | null>(null);
  const [downloadState, setDownloadState] = useState<{ capability: string; documentNumber: string } | null>(null);
  const loadGeneration = useRef(0);
  const downloadGeneration = useRef(0);

  const loadInvoices = useCallback(async () => {
    if (!bookingCapability) return;
    const generation = ++loadGeneration.current;
    const isCurrent = () => generation === loadGeneration.current
      && readPublicBookingDocumentCapability(organizationSlug) === bookingCapability;

    setBusyCapability(bookingCapability);
    setErrorState(null);
    try {
      const response = await fetch(`/api/public-bookings/${encodeURIComponent(organizationSlug)}/hospitality/tax-invoices`, {
        method: 'POST',
        headers: { 'accept': 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ bookingCapability }),
      });
      if (!isCurrent()) return;
      if (response.status === 404) {
        setHistoryState(null);
        return;
      }
      if (!response.ok) {
        setErrorState({ capability: bookingCapability, message: 'Issued tax documents could not be verified right now.' });
        return;
      }
      const data: unknown = await response.json();
      if (!isCurrent()) return;
      if (!isInvoiceHistory(data)) throw new Error('Malformed tax document history response');
      setHistoryState({ capability: bookingCapability, value: data });
    } catch {
      if (isCurrent()) setErrorState({ capability: bookingCapability, message: 'Issued tax documents could not be loaded right now.' });
    } finally {
      if (isCurrent()) setBusyCapability(null);
    }
  }, [bookingCapability, organizationSlug]);

  const downloadingDocumentNumber = downloadState?.capability === bookingCapability
    ? downloadState.documentNumber
    : null;

  const downloadPdf = useCallback(async (documentNumber: string, kind: DownloadDocumentKind) => {
    if (!bookingCapability || downloadingDocumentNumber) return;
    const generation = ++downloadGeneration.current;
    const isCurrent = () => generation === downloadGeneration.current
      && readPublicBookingDocumentCapability(organizationSlug) === bookingCapability;

    setDownloadState({ capability: bookingCapability, documentNumber });
    setErrorState(null);
    try {
      const response = await fetch(downloadPath(organizationSlug, documentNumber, kind), {
        method: 'POST',
        headers: { 'accept': 'application/pdf', 'content-type': 'application/json' },
        body: JSON.stringify({ bookingCapability }),
      });
      if (!isCurrent()) return;
      if (!response.ok) {
        setErrorState({ capability: bookingCapability, message: response.status === 422
          ? `This ${downloadLabel(kind)} contains text that cannot be represented losslessly in the current PDF format. You can still print the verified document.`
          : `The ${downloadLabel(kind)} PDF could not be prepared right now.` });
        return;
      }
      if (response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/pdf') {
        throw new Error('Unexpected PDF response content type');
      }
      const blob = await response.blob();
      if (!isCurrent()) return;
      if (blob.size < 5 || await blob.slice(0, 5).text() !== '%PDF-') {
        throw new Error('Invalid PDF response signature');
      }
      if (!isCurrent()) return;
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `${documentNumber}.pdf`;
      anchor.style.display = 'none';
      document.body.append(anchor);
      try {
        if (isCurrent()) anchor.click();
      } finally {
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
      }
    } catch {
      if (isCurrent()) setErrorState({ capability: bookingCapability, message: `The ${downloadLabel(kind)} PDF could not be downloaded right now.` });
    } finally {
      if (isCurrent()) setDownloadState(null);
    }
  }, [bookingCapability, downloadingDocumentNumber, organizationSlug]);

  useEffect(() => {
    void loadInvoices();
    return () => {
      loadGeneration.current += 1;
      downloadGeneration.current += 1;
    };
  }, [loadInvoices]);

  // The render is capability-keyed so old legal documents disappear synchronously.
  const history = historyState?.capability === bookingCapability ? historyState.value : null;
  const error = errorState?.capability === bookingCapability ? errorState.message : null;
  const busy = Boolean(bookingCapability && busyCapability === bookingCapability);

  const hasInvoices = Boolean(history?.items.length);
  const hasAdjustmentNotes = Boolean(history?.adjustmentNotes?.items.length);
  if (!hasInvoices && !hasAdjustmentNotes && !error && !busy) return null;

  return (
    <section
      className="sf-public-booking__search-card sf-public-invoice-history"
      aria-labelledby="tax-invoice-history-title"
      aria-busy={busy || undefined}
    >
      <div className="sf-public-booking__section-heading">
        <div>
          <p className="sf-public-booking__eyebrow">Issued documents</p>
          <h2 id="tax-invoice-history-title">Australian tax documents</h2>
        </div>
        {history ? <span>{history.total + (history.adjustmentNotes?.total ?? 0)} issued</span> : null}
      </div>

      {busy && !hasInvoices && !hasAdjustmentNotes ? (
        <p className="sf-public-booking__notice" role="status">Loading issued tax documents…</p>
      ) : null}
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
                <button type="button" className="sf-public-invoice__print-button" onClick={() => void downloadPdf(invoice.documentNumber, 'tax-invoice')} disabled={Boolean(downloadingDocumentNumber)} aria-busy={downloading || undefined}>
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
        const downloading = downloadingDocumentNumber === note.documentNumber;
        const increasing = note.adjustmentType === 'Increasing adjustment';
        const effectSubtotalMinor = increasing ? note.increaseSubtotalMinor : note.decreaseSubtotalMinor;
        const effectGstMinor = increasing ? note.increaseGstMinor : note.decreaseGstMinor;
        const effectTotalMinor = increasing ? note.increaseTotalMinor : note.decreaseTotalMinor;
        const effectLabel = increasing ? 'increase' : 'decrease';
        return (
          <details className="sf-public-invoice" key={note.documentNumber}>
            <summary className="sf-public-invoice__summary">
              <span><strong>{note.documentNumber}</strong><small>Adjustment note · issued {issuedDate}</small></span>
              <strong>{increasing ? '+' : '−'}{formatMinor(effectTotalMinor, note.currency)}</strong>
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
                <div><dt>Price before adjustment</dt><dd>{formatMinor(note.priceBeforeAdjustmentMinor, note.currency)}</dd></div>
                <div><dt>Price after adjustment</dt><dd>{formatMinor(note.priceAfterAdjustmentMinor, note.currency)}</dd></div>
                <div><dt>{increasing ? 'Increase' : 'Decrease'} excl. GST</dt><dd>{formatMinor(effectSubtotalMinor, note.currency)}</dd></div>
                <div><dt>GST {effectLabel}</dt><dd>{formatMinor(effectGstMinor, note.currency)}</dd></div>
                <div className="sf-public-invoice__total"><dt>Total {effectLabel} incl. GST</dt><dd>{formatMinor(effectTotalMinor, note.currency)}</dd></div>
              </dl>
              <p className="sf-public-booking__contact-note">{adjustmentNoteStatement(note)}</p>
              <div className="sf-public-invoice__actions">
                <button type="button" className="sf-public-invoice__print-button" onClick={() => void downloadPdf(note.documentNumber, 'adjustment-note')} disabled={Boolean(downloadingDocumentNumber)} aria-busy={downloading || undefined}>
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

      {hasInvoices || hasAdjustmentNotes || error ? (
        <button
          type="button"
          className="sf-public-booking__contact"
          onClick={loadInvoices}
          disabled={busy || Boolean(downloadingDocumentNumber)}
          aria-busy={busy || undefined}
        >
          {busy ? 'Refreshing…' : hasInvoices || hasAdjustmentNotes ? 'Refresh tax documents' : 'Try again'}
        </button>
      ) : null}
    </section>
  );
}
