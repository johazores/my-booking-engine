import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { PrintInvoiceAction } from '@/components/print-invoice-action.tsx';
import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import {
  HospitalityIssuedInvoiceUnavailableError,
  getHospitalityIssuedTaxInvoiceDocument,
} from '@/server/payments/hospitality-issued-invoice-read-service.ts';
import { moneyMinorToMajorString } from '@/server/pricing/money.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

function money(amountMinor: string, currency: string) {
  return `${currency} ${moneyMinorToMajorString(BigInt(amountMinor), currency)}`;
}

function addressLines(party: {
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string | null;
}) {
  const locality = [party.city, party.region, party.postalCode].filter(Boolean).join(' ');
  return [party.addressLine1, party.addressLine2, locality || null, party.countryCode].filter((line): line is string => Boolean(line));
}

export default async function TaxInvoicePage({ params }: { params: Promise<{ 'document-number': string }> }) {
  const authState = await readAuthSessionState();
  const authRedirect = getAuthRequiredRedirect(authState);
  if (authRedirect) redirect(authRedirect);
  const session = authState.session;
  if (!session) throw new Error('Authenticated invoice guard returned without a session');
  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) redirect('/dashboard?error=tenant');

  let invoice;
  try {
    invoice = await getHospitalityIssuedTaxInvoiceDocument({
      organizationId: activeContext.organization.id,
      actorUserId: session.user.id,
      documentNumber: decodeURIComponent((await params)['document-number']),
    });
  } catch (error) {
    if (error instanceof HospitalityIssuedInvoiceUnavailableError) notFound();
    throw error;
  }

  const sellerAddress = addressLines(invoice.seller);
  const buyerAddress = addressLines(invoice.buyer);
  const pdfHref = `/api/invoices/hospitality/${encodeURIComponent(invoice.documentNumber)}/pdf`;
  return <div className="sf-invoice-page">
    <div className="sf-invoice-toolbar">
      <Link className="sf-button sf-button--secondary" href={`/bookings/${invoice.bookingId}`}>Back to booking</Link>
      <a className="sf-button sf-button--secondary" href={pdfHref} download={`${invoice.documentNumber}.pdf`}>Download PDF</a>
      <PrintInvoiceAction />
    </div>
    <article className="sf-invoice-document" aria-labelledby="tax-invoice-title">
      <header className="sf-invoice-document__header"><div><p className="sf-eyebrow">Australian GST document</p><h1 id="tax-invoice-title">Tax invoice</h1></div><div className="sf-invoice-document__number"><span>Invoice number</span><strong>{invoice.documentNumber}</strong><span>Issued {new Date(invoice.issuedAt).toLocaleDateString('en-AU')}</span></div></header>
      <div className="sf-invoice-parties">
        <section className="sf-invoice-party" aria-labelledby="invoice-seller-title"><h2 id="invoice-seller-title">Seller</h2><p><strong>{invoice.seller.legalName}</strong></p><p>ABN {invoice.supplierAbn}</p>{sellerAddress.map((line, index) => <p key={`seller:${index}`}>{line}</p>)}{invoice.seller.contactEmail ? <p>{invoice.seller.contactEmail}</p> : null}</section>
        <section className="sf-invoice-party" aria-labelledby="invoice-buyer-title"><h2 id="invoice-buyer-title">Buyer</h2><p><strong>{invoice.buyer.legalName}</strong></p>{invoice.buyerAbn ? <p>ABN {invoice.buyerAbn}</p> : null}{buyerAddress.map((line, index) => <p key={`buyer:${index}`}>{line}</p>)}{invoice.buyer.email ? <p>{invoice.buyer.email}</p> : null}</section>
      </div>
      <div className="sf-room-table-wrap"><table className="sf-invoice-table"><thead><tr><th scope="col">Supply</th><th scope="col">Quantity</th><th scope="col">Amount excl. GST</th></tr></thead><tbody>{invoice.lines.map((line, index) => <tr key={`${line.description}:${index}`}><th scope="row">{line.description}</th><td>{line.quantity}</td><td>{money(line.amountMinor, invoice.currency)}</td></tr>)}</tbody></table></div>
      <div className="sf-invoice-totals"><div><span>Subtotal excl. GST</span><strong>{money(invoice.subtotalBeforeGstMinor, invoice.currency)}</strong></div><div><span>GST</span><strong>{money(invoice.gstMinor, invoice.currency)}</strong></div><div className="sf-invoice-totals__total"><span>Total incl. GST</span><strong>{money(invoice.totalMinor, invoice.currency)}</strong></div></div>
      <p className="sf-invoice-note">{invoice.taxableSaleStatement}</p>
    </article>
  </div>;
}
