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

type InvoiceHistory = {
  total: number;
  truncated: boolean;
  items: PublicTaxInvoice[];
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
        setError('Issued tax invoices could not be verified right now.');
        return;
      }
      const data = await response.json() as InvoiceHistory;
      setHistory(data);
    } catch {
      setError('Issued tax invoices could not be loaded right now.');
    } finally {
      setBusy(false);
    }
  }, [organizationSlug]);

  useEffect(() => {
    void loadInvoices();
  }, [loadInvoices]);

  if (!history?.items.length && !error) return null;

  return (
    <section className="sf-public-booking__search-card sf-public-invoice-history" aria-labelledby="tax-invoice-history-title">
      <div className="sf-public-booking__section-heading">
        <div>
          <p className="sf-public-booking__eyebrow">Issued documents</p>
          <h2 id="tax-invoice-history-title">Australian tax invoices</h2>
        </div>
        {history ? <span>{history.total} issued</span> : null}
      </div>

      {error ? <p className="sf-public-booking__alert" role="alert">{error}</p> : null}
      {history?.truncated ? <p className="sf-public-booking__notice">Showing the 50 most recent issued tax invoices for this booking.</p> : null}

      {history?.items.map((invoice, index) => {
        const sellerAddress = addressLines(invoice.seller);
        const buyerAddress = addressLines(invoice.buyer);
        const issuedDate = new Date(invoice.issuedAt).toLocaleDateString('en-AU');
        return (
          <details className="sf-public-invoice" key={invoice.documentNumber} open={index === 0 ? true : undefined}>
            <summary className="sf-public-invoice__summary">
              <span><strong>{invoice.documentNumber}</strong><small>Issued {issuedDate}</small></span>
              <strong>{formatMinor(invoice.totalMinor, invoice.currency)}</strong>
            </summary>
            <div className="sf-public-invoice__body">
              <header className="sf-public-invoice__document-heading">
                <div>
                  <p className="sf-public-booking__eyebrow">{invoice.documentTitle}</p>
                  <h3>{invoice.documentNumber}</h3>
                </div>
                <p><span>Issued</span><strong>{issuedDate}</strong></p>
              </header>

              <div className="sf-public-invoice__parties">
                <section aria-label="Tax invoice seller">
                  <h3>Seller</h3>
                  <p><strong>{invoice.seller.legalName}</strong></p>
                  <p>ABN {invoice.supplierAbn}</p>
                  {sellerAddress.map((line, lineIndex) => <p key={`seller:${lineIndex}`}>{line}</p>)}
                  {invoice.seller.contactEmail ? <p>{invoice.seller.contactEmail}</p> : null}
                </section>
                <section aria-label="Tax invoice buyer">
                  <h3>Buyer</h3>
                  <p><strong>{invoice.buyer.legalName}</strong></p>
                  {invoice.buyerAbn ? <p>ABN {invoice.buyerAbn}</p> : null}
                  {buyerAddress.map((line, lineIndex) => <p key={`buyer:${lineIndex}`}>{line}</p>)}
                  {invoice.buyer.email ? <p>{invoice.buyer.email}</p> : null}
                </section>
              </div>

              <div className="sf-public-invoice__table-wrap">
                <table className="sf-public-invoice__table">
                  <thead><tr><th scope="col">Supply</th><th scope="col">Quantity</th><th scope="col">Price excl. GST</th></tr></thead>
                  <tbody>{invoice.lines.map((line, lineIndex) => (
                    <tr key={`${line.description}:${lineIndex}`}>
                      <th scope="row">{line.description}</th>
                      <td>{line.quantity}</td>
                      <td>{formatMinor(line.amountMinor, invoice.currency)}</td>
                    </tr>
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
                <button
                  type="button"
                  className="sf-public-invoice__print-button"
                  onClick={(event) => printInvoice(event.currentTarget)}
                >
                  Print or save copy
                </button>
              </div>
            </div>
          </details>
        );
      })}

      {history?.items.length ? (
        <button type="button" className="sf-public-booking__contact" onClick={loadInvoices} disabled={busy}>
          {busy ? 'Refreshing…' : 'Refresh tax invoices'}
        </button>
      ) : null}
    </section>
  );
}
