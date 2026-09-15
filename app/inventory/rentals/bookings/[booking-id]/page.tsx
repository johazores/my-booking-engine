import Link from 'next/link';
import { redirect } from 'next/navigation';

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
};

export default async function RentalBookingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ 'booking-id': string }>;
  searchParams: Promise<{ status?: string }>;
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
  const canRead = Boolean(
    authorization.platformAdmin
      || (authorization.role && organizationRoleHasPermission(authorization.role, 'booking:read')),
  );
  const canReadAvailability = Boolean(
    authorization.platformAdmin
      || (authorization.role && organizationRoleHasPermission(authorization.role, 'availability:read')),
  );
  const canReadInventory = Boolean(
    authorization.platformAdmin
      || (authorization.role && organizationRoleHasPermission(authorization.role, 'inventory:read')),
  );
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

  return <div className="sf-inventory-page">
    <header className="sf-inventory-page__header">
      <div><p className="sf-eyebrow">Rental booking</p><h1>{booking.customerFirstName} {booking.customerLastName}</h1><p>Durable booking and physical-unit allocation evidence for {activeContext.organization.name}.</p></div>
      <div className="sf-image-scope__nav"><Link className="sf-button sf-button--secondary" href="/inventory/rentals/bookings">Rental bookings</Link>{canReadAvailability ? <Link className="sf-button sf-button--secondary" href={`/inventory/rentals/holds/${booking.holdId}`}>Source hold</Link> : null}{canReadInventory ? <Link className="sf-button sf-button--secondary" href={`/inventory/rentals/units/${booking.unitId}`}>Physical unit</Link> : null}</div>
    </header>

    {query.status && statuses[query.status] ? <p className="sf-alert sf-alert--success" role="status">{statuses[query.status]}</p> : null}
    {!booking.allocation ? <p className="sf-alert sf-alert--error" role="alert">This booking is missing its physical-unit allocation. Treat the record as an integrity incident until repaired.</p> : null}

    <section className="sf-inventory-card" aria-labelledby="rental-booking-lifecycle-title">
      <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Lifecycle</p><h2 id="rental-booking-lifecycle-title">Booking commitment</h2></div><span>{booking.status}</span></div>
      <ul className="sf-inventory-list">
        <li><div className="sf-inventory-list__primary"><div><strong>Rental period</strong><span>{booking.startsOn.toISOString().slice(0, 10)} through {booking.endsOn.toISOString().slice(0, 10)} (end exclusive)</span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>Confirmed</strong><span><time dateTime={booking.confirmedAt.toISOString()}>{booking.confirmedAt.toISOString()}</time></span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>Physical allocation</strong><span>{booking.allocation ? `${booking.unit.name} (${booking.unit.code}) is allocated for the exact booking dates.` : 'Allocation missing'}</span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>Operating location</strong><span>{booking.location.name} ({booking.location.code}) · {booking.location.city}, {booking.location.countryCode} · {booking.location.timeZone}</span></div></div></li>
      </ul>
      <p className="sf-field-hint">Cancellation, amendments, rescheduling, payment/deposit collection, pickup, delivery, return, and fulfillment are not implied by this booking state and have no primary action on this screen.</p>
    </section>

    <section className="sf-inventory-card" aria-labelledby="rental-booking-customer-title">
      <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Immutable snapshot</p><h2 id="rental-booking-customer-title">Customer evidence</h2></div><span>{booking.customer.status.toLowerCase()} profile</span></div>
      <ul className="sf-inventory-list">
        <li><div className="sf-inventory-list__primary"><div><strong>{booking.customerFirstName} {booking.customerLastName}</strong><span>{booking.customerEmail ?? 'No email snapshot'} · {booking.customerPhone ?? 'No phone snapshot'}</span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>Customer reference</strong><span><code>{booking.customerId}</code></span></div></div></li>
      </ul>
      <p className="sf-field-hint">These contact fields are the immutable booking-time snapshot. The linked mutable customer profile may later change or be archived without rewriting retained booking evidence.</p>
    </section>

    <section className="sf-inventory-card" aria-labelledby="rental-booking-commercial-title">
      <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Commercial evidence</p><h2 id="rental-booking-commercial-title">Reviewed price</h2></div><span>{booking.currency} {moneyMinorToMajorString(booking.totalMinor, booking.currency)}</span></div>
      <ul className="sf-inventory-list">
        <li><div className="sf-inventory-list__primary"><div><strong>Pricing fingerprint</strong><span><code>{booking.pricingFingerprint}</code></span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>Authority fingerprint</strong><span><code>{booking.authorityFingerprint}</code></span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>Pricing observed</strong><span><time dateTime={booking.pricingObservedAt.toISOString()}>{booking.pricingObservedAt.toISOString()}</time></span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>Idempotency key</strong><span><code>{booking.idempotencyKey}</code></span></div></div></li>
      </ul>
    </section>
  </div>;
}
