import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { PrintInvoiceAction } from '@/components/print-invoice-action.tsx';
import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import {
  getHospitalityIssuedAdjustmentNoteDocument,
  HospitalityIssuedAdjustmentNoteUnavailableError,
} from '@/server/payments/hospitality-issued-adjustment-note-read-service.ts';
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

export default async function AdjustmentNotePage({ params }: { params: Promise<{ 'document-number': string }> }) {
  const authState = await readAuthSessionState();
  const authRedirect = getAuthRequiredRedirect(authState);
  if (authRedirect) redirect(authRedirect);
  const session = authState.session;
  if (!session) throw new Error('Authenticated adjustment-note guard returned without a session');
  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) redirect('/dashboard?error=tenant');

  let document;
  try {
    document = await getHospitalityIssuedAdjustmentNoteDocument({
      organizationId: activeContext.organization.id,
      actorUserId: session.user.id,
      documentNumber: decodeURIComponent((await params)['document-number']),
    });
  } catch (error) {
    if (error instanceof HospitalityIssuedAdjustmentNoteUnavailableError) notFound();
    throw error;
  }

  const sellerAddress = addressLines(document.seller);
  const buyerAddress = addressLines(document.buyer);
  const cancellationAdjustment = document.adjustmentReason === 'Booking cancellation';
  const pdfHref = `/api/invoices/hospitality/adjustments/${encodeURIComponent(document.documentNumber)}/pdf`;
  return <div className="sf-invoice-page">
    <div className="sf-invoice-toolbar">
      <Link className="sf-button sf-button--secondary" href={`/invoices/${encodeURIComponent(document.sourceTaxInvoiceNumber)}`}>Back to tax invoice</Link>
      <Link className="sf-button sf-button--secondary" href={`/bookings/${document.bookingId}`}>View booking</Link>
      {cancellationAdjustment ? <a className="sf-button sf-button--secondary" href={pdfHref} download={`${document.documentNumber}.pdf`}>Download PDF</a> : null}
      <PrintInvoiceAction />
    </div>
    <article className="sf-invoice-document" aria-labelledby="adjustment-note-title">
      <header className="sf-invoice-document__header">
        <div><p className="sf-eyebrow">Australian GST document</p><h1 id="adjustment-note-title">Adjustment note</h1></div>
        <div className="sf-invoice-document__number">
          <span>Adjustment note number</span>
          <strong>{document.documentNumber}</strong>
          <span>Issued {new Date(document.issuedAt).toLocaleDateString('en-AU', { timeZone: 'UTC' })}</span>
        </div>
      </header>
      <div className="sf-invoice-parties">
        <section className="sf-invoice-party" aria-labelledby="adjustment-seller-title">
          <h2 id="adjustment-seller-title">Seller</h2><p><strong>{document.seller.legalName}</strong></p><p>ABN {document.supplierAbn}</p>
          {sellerAddress.map((line, index) => <p key={`seller:${index}`}>{line}</p>)}
          {document.seller.contactEmail ? <p>{document.seller.contactEmail}</p> : null}
        </section>
        <section className="sf-invoice-party" aria-labelledby="adjustment-buyer-title">
          <h2 id="adjustment-buyer-title">Buyer</h2><p><strong>{document.buyer.legalName}</strong></p>
          {buyerAddress.map((line, index) => <p key={`buyer:${index}`}>{line}</p>)}
          {document.buyer.email ? <p>{document.buyer.email}</p> : null}
        </section>
      </div>
      <div className="sf-inventory-summary">
        <div><span>Adjustment type</span><strong>{document.adjustmentType}</strong></div>
        <div><span>Reason</span><strong>{document.adjustmentReason}</strong></div>
        <div><span>Original tax invoice</span><strong><Link href={`/invoices/${encodeURIComponent(document.sourceTaxInvoiceNumber)}`}>{document.sourceTaxInvoiceNumber}</Link></strong></div>
        <div><span>Original invoice date</span><strong>{new Date(document.sourceTaxInvoiceIssuedAt).toLocaleDateString('en-AU', { timeZone: 'UTC' })}</strong></div>
        <div><span>Price before adjustment</span><strong>{money(document.priceBeforeAdjustmentMinor, document.currency)}</strong></div>
        <div><span>Price after adjustment</span><strong>{money(document.priceAfterAdjustmentMinor, document.currency)}</strong></div>
      </div>
      <div className="sf-invoice-totals">
        <div><span>Decrease excl. GST</span><strong>{money(document.decreaseSubtotalMinor, document.currency)}</strong></div>
        <div><span>GST decrease</span><strong>{money(document.decreaseGstMinor, document.currency)}</strong></div>
        <div className="sf-invoice-totals__total"><span>Total decrease incl. GST</span><strong>{money(document.decreaseTotalMinor, document.currency)}</strong></div>
      </div>
      <p className="sf-invoice-note">{cancellationAdjustment
        ? 'This decreasing adjustment records the full cancellation and refund of the taxable sale shown on the original tax invoice. The original tax invoice remains immutable.'
        : 'This decreasing adjustment records the applied commercial booking amendment against the taxable sale shown on the original tax invoice. The original tax invoice remains immutable.'}</p>
    </article>
  </div>;
}
