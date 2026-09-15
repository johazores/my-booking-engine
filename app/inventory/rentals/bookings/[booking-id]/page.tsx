import Link from 'next/link';
import { redirect } from 'next/navigation';

import { RentalBookingCancelAction } from '@/components/rental-booking-cancel-action.tsx';
import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { organizationRoleHasPermission } from '@/server/authorization/authorization-domain.ts';
import { readOrganizationAuthorization } from '@/server/authorization/authorization-service.ts';
import {
  getRentalBooking,
  RentalBookingUnavailableError,
} from '@/server/bookings/rental-booking-read-service.ts';
import { moneyMinorToMajorString } from '@/server/pricing/money.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

const statuses: Record<string, string> = {
  'booking-confirmed': 'Rental booking confirmed and physical inventory committed.',
  'booking-existing': 'This confirmation request already completed earlier. The existing rental booking is shown below.',
  'booking-cancelled': 'Rental booking cancelled. Its physical unit and date range are available for new inventory decisions again.',
  'booking-already-cancelled': 'This rental booking was already cancelled. No duplicate lifecycle change was applied.',
  'booking-rescheduled': 'Rental booking rescheduled. The effective physical-unit allocation now uses the reviewed target dates.',
  'booking-reschedule-existing': 'This rental reschedule request already completed earlier. The current effective booking is shown below.',
  'booking-unit-substituted': 'Rental booking physical unit replaced. The new effective unit now protects the current rental period.',
  'booking-unit-substitution-existing': 'This replacement request already completed earlier. The current effective booking is shown below.',
};

const errors: Record<string, string> = {
  permission: 'Your organization role cannot change this rental booking.',
  conflict: 'The rental booking changed or its retained allocation is inconsistent. Refresh the booking before trying again.',
  unavailable: 'This rental booking is no longer available in the active organization.',
  validation: 'The rental booking request was invalid.',
  server: 'The rental booking change could not be completed. No successful change was recorded.',
};

export default async function RentalBookingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ 'booking-id': string }>;
  searchParams: Promise<{ status?: string; error?: string }>;
}) {
  const authState = await readAuthSessionState();
  const authRedirect = getAuthRequiredRedirect(authState);
  if (authRedirect) redirect(authRedirect);
  const session = authState.session;
  if (!session) throw new Error('Authenticated rental booking detail guard returned without a session');

  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) redirect('/inventory?error=tenant');
  const authorization = await readOrganizationAuthorization({
    organizationId: activeContext.organization.id,
    userId: session.user.id,
  });
  const hasPermission = (permission: Parameters<typeof organizationRoleHasPermission>[1]) => Boolean(
    authorization.platformAdmin
      || (authorization.role && organizationRoleHasPermission(authorization.role, permission)),
  );
  const canRead = hasPermission('booking:read');
  const canReadAvailability = hasPermission('availability:read');
  const canReadInventory = hasPermission('inventory:read');
  const canReadPricing = hasPermission('pricing:read');
  const canManageBooking = hasPermission('booking:manage');
  const canManageAvailability = hasPermission('availability:manage');
  if (!canRead) {
    return <section className="sf-inventory-empty"><p className="sf-eyebrow">Rental bookings</p><h1>Booking access is restricted</h1><p>Your organization role does not include booking access.</p></section>;
  }

  const routeParams = await params;
  const query = await searchParams;
  let booking: Awaited<ReturnType<typeof getRentalBooking>>;
  try {
    booking = await getRentalBooking({
      organizationId: activeContext.organization.id,
      actorUserId: session.user.id,
      bookingId: routeParams['booking-id'],
    });
  } catch (error) {
    if (error instanceof RentalBookingUnavailableError) {
      return <section className="sf-inventory-empty"><p className="sf-eyebrow">Rental bookings</p><h1>Booking not available</h1><p>This rental booking does not exist in the active organization.</p><Link className="sf-button sf-button--secondary" href="/inventory/rentals/bookings">Back to rental bookings</Link></section>;
    }
    throw error;
  }

  const canCancel = booking.status === 'CONFIRMED'
    && Boolean(booking.allocation)
    && canManageBooking
    && canManageAvailability;
  const canReviewReschedule = booking.status === 'CONFIRMED'
    && Boolean(booking.allocation)
    && canManageBooking
    && canReadAvailability
    && canReadInventory
    && canReadPricing;
  const canReviewUnitSubstitution = booking.status === 'CONFIRMED'
    && Boolean(booking.allocation)
    && canManageBooking
    && canReadAvailability
    && canReadInventory;
  const effectiveStartsOn = booking.allocation?.startsOn ?? booking.startsOn;
  const effectiveEndsOn = booking.allocation?.endsOn ?? booking.endsOn;
  const effectiveUnit = booking.allocation?.unit ?? booking.unit;

  return <div className="sf-inventory-page">
    <header className="sf-inventory-page__header">
      <div><p className="sf-eyebrow">Rental booking</p><h1>{booking.customerFirstName} {booking.customerLastName}</h1><p>Durable booking and physical-unit allocation evidence for {activeContext.organization.name}.</p></div>
      <div className="sf-image-scope__nav"><Link className="sf-button sf-button--secondary" href="/inventory/rentals/bookings">Rental bookings</Link>{canReadAvailability ? <Link className="sf-button sf-button--secondary" href={`/inventory/rentals/holds/${booking.holdId}`}>Source hold</Link> : null}{canReadInventory && booking.allocation ? <Link className="sf-button sf-button--secondary" href={`/inventory/rentals/units/${booking.allocation.unitId}`}>Effective unit</Link> : null}{canReviewReschedule ? <Link className="sf-button sf-button--secondary" href={`/inventory/rentals/bookings/${booking.id}/reschedule`}>Reschedule rental</Link> : null}{canReviewUnitSubstitution ? <Link className="sf-button sf-button--secondary" href={`/inventory/rentals/bookings/${booking.id}/unit-substitution`}>Replace unit</Link> : null}</div>
    </header>

    {query.status && statuses[query.status] ? <p className="sf-alert sf-alert--success" role="status">{statuses[query.status]}</p> : null}
    {query.error && errors[query.error] ? <p className="sf-alert sf-alert--error" role="alert">{errors[query.error]}</p> : null}
    {!booking.allocation ? <p className="sf-alert sf-alert--error" role="alert">This booking is missing its physical-unit allocation. Treat the record as an integrity incident until repaired.</p> : null}

    <section className="sf-inventory-card" aria-labelledby="rental-booking-lifecycle-title">
      <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Lifecycle</p><h2 id="rental-booking-lifecycle-title">Booking commitment</h2></div><span>{booking.status}</span></div>
      <ul className="sf-inventory-list">
        <li><div className="sf-inventory-list__primary"><div><strong>Effective rental period</strong><span>{effectiveStartsOn.toISOString().slice(0, 10)} through {effectiveEndsOn.toISOString().slice(0, 10)} (end exclusive)</span></div></div></li>
        {booking.reschedules.length > 0 ? <li><div className="sf-inventory-list__primary"><div><strong>Original booking-time period</strong><span>{booking.startsOn.toISOString().slice(0, 10)} through {booking.endsOn.toISOString().slice(0, 10)} · retained immutable evidence</span></div></div></li> : null}
        <li><div className="sf-inventory-list__primary"><div><strong>Confirmed</strong><span><time dateTime={booking.confirmedAt.toISOString()}>{booking.confirmedAt.toISOString()}</time></span></div></div></li>
        {booking.cancelledAt ? <li><div className="sf-inventory-list__primary"><div><strong>Cancelled</strong><span><time dateTime={booking.cancelledAt.toISOString()}>{booking.cancelledAt.toISOString()}</time></span></div></div></li> : null}
        <li><div className="sf-inventory-list__primary"><div><strong>Effective physical allocation</strong><span>{booking.allocation ? booking.status === 'CANCELLED' ? `${effectiveUnit.name} (${effectiveUnit.code}) allocation is retained as historical evidence and no longer protects live availability.` : `${effectiveUnit.name} (${effectiveUnit.code}) protects the effective rental period.` : 'Allocation missing'}</span></div></div></li>
        {booking.unitSubstitutions.length > 0 ? <li><div className="sf-inventory-list__primary"><div><strong>Original booking-time unit</strong><span>{booking.unit.name} ({booking.unit.code}) · retained immutable evidence</span></div></div></li> : null}
        <li><div className="sf-inventory-list__primary"><div><strong>Operating location</strong><span>{booking.location.name} ({booking.location.code}) · {booking.location.city}, {booking.location.countryCode} · {booking.location.timeZone}</span></div></div></li>
      </ul>
      <p className="sf-field-hint">Authorized staff can apply same-unit, price-neutral date reschedules, same-type same-location physical-unit substitutions, and terminal cancellation. Unit-type/location changes, price-changing amendments, payment/deposit collection, pickup, delivery, return, and fulfillment remain separate unsupported contracts.</p>
    </section>

    {booking.unitSubstitutions.length > 0 ? <section className="sf-inventory-card" aria-labelledby="rental-booking-unit-substitution-history-title">
      <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Append-only history</p><h2 id="rental-booking-unit-substitution-history-title">Physical-unit substitution evidence</h2></div><span>{booking.unitSubstitutions.length} applied</span></div>
      <ul className="sf-inventory-list">{booking.unitSubstitutions.map((substitution) => <li key={substitution.id}><div className="sf-inventory-list__primary"><div><strong>{substitution.sourceUnit.name} ({substitution.sourceUnit.code}) → {substitution.targetUnit.name} ({substitution.targetUnit.code})</strong><span>{substitution.startsOn.toISOString().slice(0, 10)} through {substitution.endsOn.toISOString().slice(0, 10)} · accepted {substitution.currency} {moneyMinorToMajorString(substitution.totalMinor, substitution.currency)}</span><span>Authority <code>{substitution.authorityFingerprint}</code> · applied <time dateTime={substitution.appliedAt.toISOString()}>{substitution.appliedAt.toISOString()}</time></span></div></div></li>)}</ul>
    </section> : null}

    {booking.reschedules.length > 0 ? <section className="sf-inventory-card" aria-labelledby="rental-booking-reschedule-history-title">
      <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Append-only history</p><h2 id="rental-booking-reschedule-history-title">Reschedule evidence</h2></div><span>{booking.reschedules.length} applied</span></div>
      <ul className="sf-inventory-list">{booking.reschedules.map((reschedule) => <li key={reschedule.id}><div className="sf-inventory-list__primary"><div><strong>{reschedule.sourceStartsOn.toISOString().slice(0, 10)} → {reschedule.targetStartsOn.toISOString().slice(0, 10)}</strong><span>{reschedule.sourceStartsOn.toISOString().slice(0, 10)} through {reschedule.sourceEndsOn.toISOString().slice(0, 10)} became {reschedule.targetStartsOn.toISOString().slice(0, 10)} through {reschedule.targetEndsOn.toISOString().slice(0, 10)}</span><span>Pricing fingerprint <code>{reschedule.targetPricingFingerprint}</code> · applied <time dateTime={reschedule.appliedAt.toISOString()}>{reschedule.appliedAt.toISOString()}</time></span></div></div></li>)}</ul>
    </section> : null}

    {canCancel ? <section className="sf-inventory-card" aria-labelledby="rental-booking-cancel-title">
      <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Inventory release</p><h2 id="rental-booking-cancel-title">Cancel rental booking</h2></div></div>
      <RentalBookingCancelAction bookingId={booking.id} />
    </section> : null}

    <section className="sf-inventory-card" aria-labelledby="rental-booking-customer-title">
      <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Immutable snapshot</p><h2 id="rental-booking-customer-title">Customer evidence</h2></div><span>{booking.customer.status.toLowerCase()} profile</span></div>
      <ul className="sf-inventory-list">
        <li><div className="sf-inventory-list__primary"><div><strong>{booking.customerFirstName} {booking.customerLastName}</strong><span>{booking.customerEmail ?? 'No email snapshot'} · {booking.customerPhone ?? 'No phone snapshot'}</span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>Customer reference</strong><span><code>{booking.customerId}</code></span></div></div></li>
      </ul>
      <p className="sf-field-hint">These contact fields are the immutable booking-time snapshot. The linked mutable customer profile may later change or be archived without rewriting retained booking evidence.</p>
    </section>

    <section className="sf-inventory-card" aria-labelledby="rental-booking-commercial-title">
      <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Commercial evidence</p><h2 id="rental-booking-commercial-title">Accepted amount</h2></div><span>{booking.currency} {moneyMinorToMajorString(booking.totalMinor, booking.currency)}</span></div>
      <ul className="sf-inventory-list">
        <li><div className="sf-inventory-list__primary"><div><strong>Original pricing fingerprint</strong><span><code>{booking.pricingFingerprint}</code></span></div></div></li>
        {booking.reschedules.at(-1) ? <li><div className="sf-inventory-list__primary"><div><strong>Effective pricing fingerprint</strong><span><code>{booking.reschedules.at(-1)?.targetPricingFingerprint}</code></span></div></div></li> : null}
        <li><div className="sf-inventory-list__primary"><div><strong>Conversion authority fingerprint</strong><span><code>{booking.authorityFingerprint}</code></span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>Pricing observed</strong><span><time dateTime={booking.pricingObservedAt.toISOString()}>{booking.pricingObservedAt.toISOString()}</time></span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>Confirmation idempotency key</strong><span><code>{booking.idempotencyKey}</code></span></div></div></li>
      </ul>
    </section>
  </div>;
}
