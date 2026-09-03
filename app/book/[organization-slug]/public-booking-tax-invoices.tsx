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
        headers: { 'content-type': 'application/json' },
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
    <section className="sf-public-booking__search-card" aria-labelledby="tax-invoice-history-title">
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
        return (
          <details className="sf-public-invoice" key={invoice.documentNumber} open={index === 0}>
            <summary className="sf-public-invoice__summary">
              <span><strong>{invoice.documentNumber}</strong><small>Issued {new Date(invoice.issuedAt).toLocaleDateString('en-AU')}</small></span>
              <strong>{formatMinor(invoice.totalMinor, invoice.currency)}</strong>
            </summary>
            <div className="sf-public-invoice__body">
              <div className="sf-public-invoice__parties">
                <section aria-label="Tax invoice seller">
                  <h3>Seller</h3>
                  <p><strong>{invoice.seller.legalName}</strong></p>
                  <p>ABN {invoice.supplierAbn}</p>
                  {sellerAddress.map((line) => <p key={line}>{line}</p>)}
                  {invoice.seller.contactEmail ? <p>{invoice.seller.contactEmail}</p> : null}
                </section>
                <section aria-label="Tax invoice buyer">
                  <h3>Buyer</h3>
                  <p><strong>{invoice.buyer.legalName}</strong></p>
                  {invoice.buyerAbn ? <p>ABN {invoice.buyerAbn}</p> : null}
                  {buyerAddress.map((line) => <p key={line}>{line}</p>)}
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
