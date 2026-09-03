import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { BookingCommercialAmendmentAction } from '@/components/booking-commercial-amendment-action.tsx';
import { BookingCommercialAmendmentRecoveryAction } from '@/components/booking-commercial-amendment-recovery-action.tsx';
import { BookingTaxInvoiceAction } from '@/components/booking-tax-invoice-action.tsx';
import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import { findHospitalityBookingCommercialAmendmentRecoveryTransport } from '@/server/bookings/hospitality-booking-commercial-amendment-recovery-transport-service.ts';
import { findHospitalityBookingCommercialAmendmentTransport } from '@/server/bookings/hospitality-booking-commercial-amendment-transport-service.ts';
import { listHospitalityIssuedTaxInvoices } from '@/server/payments/hospitality-issued-invoice-read-service.ts';
import { moneyMinorToMajorString } from '@/server/pricing/money.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

function money(amountMinor: bigint, currency: string) {
  return `${currency} ${moneyMinorToMajorString(amountMinor, currency)}`;
}

export default async function BookingDetailLayout({ children, params }: {
  children: ReactNode;
  params: Promise<{ 'booking-id': string }>;
}) {
  const authState = await readAuthSessionState();
  const authRedirect = getAuthRequiredRedirect(authState);
  if (authRedirect) redirect(authRedirect);
  const session = authState.session;
  if (!session) return children;

  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) return children;
  const bookingId = (await params)['booking-id'];

  let amendment = null;
  let recovery = null;
  let invoices: Awaited<ReturnType<typeof listHospitalityIssuedTaxInvoices>> | null = null;
  try {
    [amendment, recovery, invoices] = await Promise.all([
      findHospitalityBookingCommercialAmendmentTransport({ organizationId: activeContext.organization.id, actorUserId: session.user.id, bookingId }),
      findHospitalityBookingCommercialAmendmentRecoveryTransport({ organizationId: activeContext.organization.id, actorUserId: session.user.id, bookingId }),
      listHospitalityIssuedTaxInvoices({ organizationId: activeContext.organization.id, actorUserId: session.user.id, bookingId, page: 1, pageSize: 10 }),
    ]);
  } catch (error) {
    if (!(error instanceof OrganizationPermissionDeniedError)) throw error;
  }

  return <>
    {amendment ? <div className="sf-inventory-page"><section className="sf-booking-card" aria-labelledby="booking-commercial-amendment-title"><div className="sf-booking-card__heading"><div><p className="sf-eyebrow">Commercial adjustment</p><h2 id="booking-commercial-amendment-title">Prepared booking change</h2></div><span className="sf-status-badge">payment adjustment</span></div><BookingCommercialAmendmentAction bookingId={bookingId} initialStatus={amendment} /></section></div> : null}
    {recovery ? <div className="sf-inventory-page"><section className="sf-booking-card" aria-labelledby="booking-commercial-recovery-title"><div className="sf-booking-card__heading"><div><p className="sf-eyebrow">Payment recovery</p><h2 id="booking-commercial-recovery-title">Expired commercial amendment</h2></div><span className="sf-status-badge">recovery required</span></div><BookingCommercialAmendmentRecoveryAction bookingId={bookingId} initialStatus={recovery} /></section></div> : null}
    {invoices ? <div className="sf-inventory-page"><section className="sf-booking-card" aria-labelledby="booking-tax-invoices-title"><div className="sf-booking-card__heading"><div><p className="sf-eyebrow">Legal documents</p><h2 id="booking-tax-invoices-title">Australian tax invoices</h2></div><span>{invoices.total} issued</span></div>{invoices.items.length > 0 ? <div className="sf-room-table-wrap"><table className="sf-room-table"><thead><tr><th scope="col">Invoice</th><th scope="col">Issued</th><th scope="col">Total</th><th scope="col">Document</th></tr></thead><tbody>{invoices.items.map((invoice) => <tr key={invoice.documentNumber}><th scope="row">{invoice.documentNumber}</th><td>{invoice.issuedAt.toISOString()}</td><td>{money(invoice.totalMinor, invoice.currency)}</td><td><Link href={`/invoices/${encodeURIComponent(invoice.documentNumber)}`}>View tax invoice</Link></td></tr>)}</tbody></table></div> : <div className="sf-empty-state"><h3>No tax invoice issued</h3><p>Issue only after the current immutable booking, issuer, recipient, and Australian GST evidence is ready.</p></div>}<BookingTaxInvoiceAction bookingId={bookingId} /></section></div> : null}
    {children}
  </>;
}
