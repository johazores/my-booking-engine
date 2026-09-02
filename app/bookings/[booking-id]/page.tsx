import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { BookingCancelAction } from '@/components/booking-cancel-action.tsx';
import { BookingCommercialModificationAction } from '@/components/booking-commercial-modification-action.tsx';
import { BookingGuestEditAction } from '@/components/booking-guest-edit-action.tsx';
import { BookingRefundAction } from '@/components/booking-refund-action.tsx';
import { BookingRescheduleAction } from '@/components/booking-reschedule-action.tsx';
import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { organizationRoleHasPermission } from '@/server/authorization/authorization-domain.ts';
import { readOrganizationAuthorization } from '@/server/authorization/authorization-service.ts';
import { listHospitalityBookingAuditEvents } from '@/server/bookings/hospitality-booking-audit-service.ts';
import { bookingCancellationPaymentBlockReason } from '@/server/bookings/booking-cancellation-domain.ts';
import { HospitalityBookingUnavailableError, getHospitalityBooking } from '@/server/bookings/hospitality-booking-service.ts';
import { getBookingRefundAvailability } from '@/server/payments/booking-refund-availability-service.ts';
import { getBookingPaymentReceipt } from '@/server/payments/payment-receipt-service.ts';
import { PaymentConflictError, listBookingPaymentTransactions } from '@/server/payments/payment-service.ts';
import { moneyMinorToMajorString } from '@/server/pricing/money.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

function money(amountMinor: bigint, currency: string) {
  return `${currency} ${moneyMinorToMajorString(amountMinor, currency)}`;
}

function safeProviderReference(reference: string | null) {
  return reference && !reference.startsWith('sf_claim_') ? reference : null;
}

function safeAuditPayload(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '—';
  const payload = value as Record<string, unknown>;
  const hiddenKeys = ['guestFingerprint', 'idempotencyKey', 'modificationFingerprint', 'pricingFingerprint'];
  const allowed = Object.fromEntries(Object.entries(payload).filter(([key]) => !hiddenKeys.includes(key)));
  return Object.keys(allowed).length === 0 ? '—' : JSON.stringify(allowed);
}

function editableAddonSelections(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((selection) => {
    if (!selection || typeof selection !== 'object' || Array.isArray(selection)) return [];
    const record = selection as Record<string, unknown>;
    if (typeof record.addonId !== 'string' || !Number.isSafeInteger(record.quantity) || Number(record.quantity) < 1) return [];
    return [{ addonId: record.addonId, quantity: Number(record.quantity) }];
  });
}

export default async function BookingDetailPage({ params, searchParams }: {
  params: Promise<{ 'booking-id': string }>;
  searchParams: Promise<{ paymentPage?: string; auditPage?: string }>;
}) {
  const authState = await readAuthSessionState();
  const authRedirect = getAuthRequiredRedirect(authState);
  if (authRedirect) redirect(authRedirect);
  const session = authState.session;
  if (!session) throw new Error('Authenticated booking guard returned without a session');

  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) redirect('/dashboard?error=tenant');
  const organization = activeContext.organization;
  const bookingId = (await params)['booking-id'];
  const query = await searchParams;
  const paymentPage = Number(query.paymentPage ?? '1');
  const auditPage = Number(query.auditPage ?? '1');

  let booking;
  try {
    booking = await getHospitalityBooking({ organizationId: organization.id, actorUserId: session.user.id, bookingId });
  } catch (error) {
    if (error instanceof HospitalityBookingUnavailableError) notFound();
    throw error;
  }

  const paymentAuthorization = await readOrganizationAuthorization({ organizationId: organization.id, userId: session.user.id });
  const canManagePayments = Boolean(paymentAuthorization && (
    paymentAuthorization.platformAdmin
    || (paymentAuthorization.role && organizationRoleHasPermission(paymentAuthorization.role, 'payment:manage'))
  ));

  const [paymentHistory, auditHistory, refundAvailability] = await Promise.all([
    listBookingPaymentTransactions({ organizationId: organization.id, actorUserId: session.user.id, bookingId: booking.id, page: paymentPage, pageSize: 25 }),
    listHospitalityBookingAuditEvents({ organizationId: organization.id, actorUserId: session.user.id, bookingId: booking.id, page: auditPage, pageSize: 20 }),
    canManagePayments
      ? getBookingRefundAvailability({ organizationId: organization.id, actorUserId: session.user.id, bookingId: booking.id })
      : Promise.resolve({ available: false, reason: 'Refunds require payment management permission.' } as const),
  ]);

  let receipt: Awaited<ReturnType<typeof getBookingPaymentReceipt>> | null = null;
  let receiptUnavailableReason: string | null = null;
  try {
    receipt = await getBookingPaymentReceipt({ organizationId: organization.id, actorUserId: session.user.id, bookingId: booking.id });
  } catch (error) {
    if (error instanceof PaymentConflictError) receiptUnavailableReason = error.message;
    else throw error;
  }

  const addonSelections = Array.isArray(booking.addonSelections) ? booking.addonSelections : [];
  const commercialAddonSelections = editableAddonSelections(booking.addonSelections);
  const cancellationPaymentBlockReason = bookingCancellationPaymentBlockReason(booking.paymentStatus);
  const arrivalDate = booking.arrivalDate.toISOString().slice(0, 10);
  const departureDate = booking.departureDate.toISOString().slice(0, 10);
  const maximumGuests = booking.quantity * booking.roomType.maxOccupancy;
  const paymentQuery = auditHistory.page > 1 ? `&auditPage=${auditHistory.page}` : '';
  const auditQuery = paymentHistory.page > 1 ? `&paymentPage=${paymentHistory.page}` : '';
  const refundActionAvailability = refundAvailability.available
    ? {
      available: true as const,
      providerCode: refundAvailability.providerCode,
      refundableAmount: money(refundAvailability.refundableMinor, refundAvailability.currency),
      requiresReference: refundAvailability.requiresReference,
    }
    : refundAvailability;

  return <div className="sf-inventory-page">
    <header className="sf-inventory-page__header"><div><p className="sf-eyebrow">Booking management</p><h1>Booking detail</h1><p>Server-scoped booking, guest, immutable pricing, payment, and audit records for this organization.</p></div><Link className="sf-button sf-button--secondary" href="/bookings">Back to bookings</Link></header>

    <section className="sf-booking-card" aria-labelledby="booking-summary-title"><div className="sf-booking-card__heading"><div><p className="sf-eyebrow">Reservation</p><h2 id="booking-summary-title">{booking.roomType.name} · {booking.ratePlan.name}</h2></div><span className="sf-status-badge">{booking.status.toLowerCase()}</span></div><div className="sf-inventory-summary"><div><span>Booking ID</span><strong>{booking.id}</strong></div><div><span>Payment</span><strong>{booking.paymentStatus.toLowerCase().replaceAll('_', ' ')}</strong></div><div><span>Rooms</span><strong>{booking.quantity}</strong></div><div><span>Arrival</span><strong>{arrivalDate}</strong></div><div><span>Departure</span><strong>{departureDate}</strong></div><div><span>Confirmed</span><strong>{booking.confirmedAt ? booking.confirmedAt.toISOString() : '—'}</strong></div><div><span>Cancelled</span><strong>{booking.cancelledAt ? booking.cancelledAt.toISOString() : '—'}</strong></div></div></section>

    <section className="sf-booking-card" aria-labelledby="booking-customer-title"><div className="sf-booking-card__heading"><div><p className="sf-eyebrow">Customer and travelers</p><h2 id="booking-customer-title">{booking.customer.firstName} {booking.customer.lastName}</h2></div></div><p>{booking.customer.email ?? 'No customer email recorded.'}</p>{booking.guests.length === 0 ? <div className="sf-empty-state"><h3>No guest snapshots</h3><p>No booking-specific traveler snapshots were persisted.</p></div> : <div className="sf-room-table-wrap"><table className="sf-room-table"><thead><tr><th scope="col">Guest</th><th scope="col">Email</th></tr></thead><tbody>{booking.guests.map((guest, index) => <tr key={`${guest.firstName}:${guest.lastName}:${index}`}><th scope="row">{guest.firstName} {guest.lastName}</th><td>{guest.email ?? '—'}</td></tr>)}</tbody></table></div>}<BookingGuestEditAction bookingId={booking.id} bookingStatus={booking.status} guests={booking.guests} maximumGuests={maximumGuests} /></section>

    <section className="sf-booking-card" aria-labelledby="booking-price-title"><div className="sf-booking-card__heading"><div><p className="sf-eyebrow">Immutable price snapshot</p><h2 id="booking-price-title">{money(booking.totalMinor, booking.currency)}</h2></div><span>{booking.currency}</span></div><div className="sf-inventory-summary"><div><span>Accommodation</span><strong>{money(booking.accommodationSubtotalMinor, booking.currency)}</strong></div><div><span>Taxes</span><strong>{money(booking.taxTotalMinor, booking.currency)}</strong></div><div><span>Fees</span><strong>{money(booking.feeTotalMinor, booking.currency)}</strong></div><div><span>Add-ons</span><strong>{money(booking.addonTotalMinor, booking.currency)}</strong></div></div><p><small>Pricing fingerprint: {booking.pricingFingerprint}</small></p>{addonSelections.length > 0 ? <details><summary>Selected add-ons ({addonSelections.length})</summary><pre>{JSON.stringify(addonSelections, null, 2)}</pre></details> : null}</section>

    <section className="sf-booking-card" aria-labelledby="payment-history-title"><div className="sf-booking-card__heading"><div><p className="sf-eyebrow">Payment history</p><h2 id="payment-history-title">{paymentHistory.total} transaction{paymentHistory.total === 1 ? '' : 's'}</h2></div><span>Page {paymentHistory.page} of {paymentHistory.totalPages}</span></div>{paymentHistory.transactions.length === 0 ? <div className="sf-empty-state"><h3>No payment transactions</h3><p>This booking has no persisted payment activity yet.</p></div> : <><div className="sf-room-table-wrap"><table className="sf-room-table"><thead><tr><th scope="col">Operation</th><th scope="col">Provider</th><th scope="col">Amount</th><th scope="col">Status</th><th scope="col">Reference</th><th scope="col">Created</th></tr></thead><tbody>{paymentHistory.transactions.map((transaction) => <tr key={transaction.id}><th scope="row">{transaction.kind.toLowerCase().replaceAll('_', ' ')}</th><td>{transaction.providerCode}</td><td>{money(transaction.amountMinor, transaction.currency)}</td><td>{transaction.status.toLowerCase()}</td><td>{safeProviderReference(transaction.providerReference) ?? '—'}</td><td>{transaction.createdAt.toISOString()}</td></tr>)}</tbody></table></div>{paymentHistory.totalPages > 1 ? <nav className="sf-actions" aria-label="Payment history pages">{paymentHistory.page > 1 ? <Link className="sf-button sf-button--secondary" href={`/bookings/${booking.id}?paymentPage=${paymentHistory.page - 1}${paymentQuery}`}>Previous payments</Link> : null}{paymentHistory.page < paymentHistory.totalPages ? <Link className="sf-button sf-button--secondary" href={`/bookings/${booking.id}?paymentPage=${paymentHistory.page + 1}${paymentQuery}`}>Next payments</Link> : null}</nav> : null}</>}</section>

    <section className="sf-booking-card" aria-labelledby="receipt-title"><div className="sf-booking-card__heading"><div><p className="sf-eyebrow">Receipt</p><h2 id="receipt-title">Payment receipt</h2></div>{receipt ? <span className="sf-status-badge">available</span> : null}</div>{receipt ? <div><div className="sf-inventory-summary"><div><span>Receipt number</span><strong>{receipt.receiptNumber}</strong></div><div><span>Issued</span><strong>{receipt.issuedAt.toISOString()}</strong></div><div><span>Captured</span><strong>{money(receipt.settlement.capturedMinor, booking.currency)}</strong></div><div><span>Refunded</span><strong>{money(receipt.settlement.refundedMinor, booking.currency)}</strong></div><div><span>Net paid</span><strong>{money(receipt.settlement.netPaidMinor, booking.currency)}</strong></div></div><p><small>{receipt.note}</small></p></div> : <div className="sf-empty-state"><h3>Receipt not available</h3><p>{receiptUnavailableReason ?? 'A successful settled payment is required before a receipt can be shown.'}</p></div>}</section>

    <section className="sf-booking-card" aria-labelledby="booking-refund-title"><div className="sf-booking-card__heading"><div><p className="sf-eyebrow">Payment management</p><h2 id="booking-refund-title">Refund</h2></div></div><BookingRefundAction bookingId={booking.id} availability={refundActionAvailability} /></section>

    <section className="sf-booking-card" aria-labelledby="booking-audit-title"><div className="sf-booking-card__heading"><div><p className="sf-eyebrow">Audit history</p><h2 id="booking-audit-title">{auditHistory.total} booking event{auditHistory.total === 1 ? '' : 's'}</h2></div><span>Page {auditHistory.page} of {auditHistory.totalPages}</span></div>{auditHistory.events.length === 0 ? <div className="sf-empty-state"><h3>No booking audit events</h3><p>No audit history has been persisted for this booking.</p></div> : <><div className="sf-room-table-wrap"><table className="sf-room-table"><thead><tr><th scope="col">Event</th><th scope="col">Before</th><th scope="col">After</th><th scope="col">Created</th></tr></thead><tbody>{auditHistory.events.map((event) => <tr key={event.id}><th scope="row">{event.action}</th><td>{safeAuditPayload(event.beforeData)}</td><td>{safeAuditPayload(event.afterData)}</td><td>{event.createdAt.toISOString()}</td></tr>)}</tbody></table></div>{auditHistory.totalPages > 1 ? <nav className="sf-actions" aria-label="Booking audit history pages">{auditHistory.page > 1 ? <Link className="sf-button sf-button--secondary" href={`/bookings/${booking.id}?auditPage=${auditHistory.page - 1}${auditQuery}`}>Previous events</Link> : null}{auditHistory.page < auditHistory.totalPages ? <Link className="sf-button sf-button--secondary" href={`/bookings/${booking.id}?auditPage=${auditHistory.page + 1}${auditQuery}`}>Next events</Link> : null}</nav> : null}</>}</section>

    <section className="sf-booking-card" aria-labelledby="booking-commercial-title"><div className="sf-booking-card__heading"><div><p className="sf-eyebrow">Commercial terms</p><h2 id="booking-commercial-title">Room, rate, quantity, and add-ons</h2></div></div><BookingCommercialModificationAction bookingId={booking.id} bookingStatus={booking.status} roomTypeId={booking.roomTypeId} ratePlanId={booking.ratePlanId} quantity={booking.quantity} addonSelections={commercialAddonSelections} /></section>
    <section className="sf-booking-card" aria-labelledby="booking-reschedule-title"><div className="sf-booking-card__heading"><div><p className="sf-eyebrow">Stay changes</p><h2 id="booking-reschedule-title">Reschedule</h2></div></div><BookingRescheduleAction bookingId={booking.id} bookingStatus={booking.status} arrivalDate={arrivalDate} departureDate={departureDate} /></section>
    <section className="sf-booking-card" aria-labelledby="booking-cancellation-title"><div className="sf-booking-card__heading"><div><p className="sf-eyebrow">Reservation lifecycle</p><h2 id="booking-cancellation-title">Cancellation</h2></div></div><BookingCancelAction bookingId={booking.id} bookingStatus={booking.status} paymentBlockReason={cancellationPaymentBlockReason} /></section>
  </div>;
}
