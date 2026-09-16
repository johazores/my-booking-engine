import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { organizationRoleHasPermission } from '@/server/authorization/authorization-domain.ts';
import { readOrganizationAuthorization } from '@/server/authorization/authorization-service.ts';
import {
  listRentalBookings,
  type RentalBookingListCustody,
  type RentalBookingListStatus,
} from '@/server/bookings/rental-booking-read-service.ts';
import { parseInventoryPage, parseInventoryPageSize } from '@/server/inventory/hospitality-domain.ts';
import { moneyMinorToMajorString } from '@/server/pricing/money.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

function parseStatus(value: string | undefined): RentalBookingListStatus {
  if (value === 'confirmed') return 'CONFIRMED';
  if (value === 'cancelled') return 'CANCELLED';
  return 'ALL';
}

function parseCustody(value: string | undefined): RentalBookingListCustody {
  if (value === 'overdue') return 'OVERDUE';
  if (value === 'missed-pickup' || value === 'missed_pickup') return 'MISSED_PICKUP';
  return 'ALL';
}

function bookingListHref(input: Readonly<{
  page: number;
  pageSize: number;
  status: RentalBookingListStatus;
  custody: RentalBookingListCustody;
}>) {
  const params = new URLSearchParams();
  if (input.page > 1) params.set('page', String(input.page));
  if (input.pageSize !== 20) params.set('pageSize', String(input.pageSize));
  if (input.status !== 'ALL') params.set('status', input.status.toLowerCase());
  if (input.custody !== 'ALL') params.set('custody', input.custody.toLowerCase().replaceAll('_', '-'));
  const query = params.toString();
  return query ? `/inventory/rentals/bookings?${query}` : '/inventory/rentals/bookings';
}

function emptyStateContent(custody: RentalBookingListCustody) {
  if (custody === 'OVERDUE') {
    return Object.freeze({
      title: 'No overdue rental custody matches this filter',
      description: 'Overdue custody applies only to confirmed picked-up bookings whose exclusive expected-return boundary has been reached without a recorded return.',
    });
  }
  if (custody === 'MISSED_PICKUP') {
    return Object.freeze({
      title: 'No missed rental pickups match this filter',
      description: 'Missed pickup applies only to confirmed bookings whose exclusive committed end has been reached without any recorded physical pickup.',
    });
  }
  return Object.freeze({
    title: 'No rental bookings match this filter',
    description: 'Bookings appear only after an effective hold and active customer pass the server-side conversion review and atomic confirmation boundary.',
  });
}

export default async function RentalBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; pageSize?: string; status?: string; custody?: string }>;
}) {
  const authState = await readAuthSessionState();
  const authRedirect = getAuthRequiredRedirect(authState);
  if (authRedirect) redirect(authRedirect);
  const session = authState.session;
  if (!session) throw new Error('Authenticated rental booking guard returned without a session');

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
  const canReviewUnitSubstitution = hasPermission('booking:manage')
    && hasPermission('availability:read')
    && hasPermission('inventory:read');
  if (!canRead) {
    return <section className="sf-inventory-empty"><p className="sf-eyebrow">Rental bookings</p><h1>Booking access is restricted</h1><p>Your organization role does not include booking access.</p></section>;
  }

  const params = await searchParams;
  const pageSize = parseInventoryPageSize(params.pageSize);
  const status = parseStatus(params.status);
  const custody = parseCustody(params.custody);
  const result = await listRentalBookings({
    organizationId: activeContext.organization.id,
    actorUserId: session.user.id,
    status,
    custody,
    page: parseInventoryPage(params.page),
    pageSize,
  });
  const emptyState = emptyStateContent(custody);

  return <div className="sf-inventory-page">
    <header className="sf-inventory-page__header">
      <div><p className="sf-eyebrow">Rental operations</p><h1>Rental bookings</h1><p>Review durable physical-unit commitments created from revalidated rental holds for {activeContext.organization.name}.</p></div>
      <div className="sf-image-scope__nav"><Link className="sf-button sf-button--primary" href="/inventory/rentals/holds">Active holds</Link><Link className="sf-button sf-button--secondary" href="/inventory/rentals/availability">Availability preview</Link><Link className="sf-button sf-button--secondary" href="/inventory/rentals">Rental inventory</Link></div>
    </header>

    <section className="sf-inventory-card" aria-labelledby="rental-booking-filter-title">
      <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">History</p><h2 id="rental-booking-filter-title">Booking records</h2></div><span>{result.total} matching · {result.overdueCount} overdue custody · {result.missedPickupCount} missed pickup</span></div>
      <form method="get" className="sf-form-row">
        <label className="sf-field">Status<select name="status" defaultValue={status.toLowerCase()}><option value="all">All</option><option value="confirmed">Confirmed</option><option value="cancelled">Cancelled</option></select></label>
        <label className="sf-field">Operational state<select name="custody" defaultValue={custody.toLowerCase().replaceAll('_', '-')}><option value="all">All</option><option value="overdue">Overdue custody only</option><option value="missed-pickup">Missed pickup only</option></select></label>
        <label className="sf-field">Rows per page<select name="pageSize" defaultValue={String(pageSize)}><option value="20">20</option><option value="50">50</option><option value="100">100</option></select></label>
        <button className="sf-button sf-button--secondary" type="submit">Apply filters</button>
      </form>
      <p className="sf-field-hint">A confirmed rental booking means SF has committed the current effective physical unit under reviewed commercial evidence. The committed period follows supported reschedules; live inventory protection may end earlier only after an explicit post-return release. Picked-up bookings whose exclusive committed end has been reached are overdue custody until return. Awaiting-pickup bookings whose exclusive committed end has been reached are surfaced separately as missed pickup without inventing cancellation, fees, refunds, or extensions.</p>
      {result.overdueCount > 0 && custody !== 'OVERDUE' ? <p className="sf-field-hint"><Link href={bookingListHref({ page: 1, pageSize, status: 'CONFIRMED', custody: 'OVERDUE' })}>Review {result.overdueCount} overdue custody {result.overdueCount === 1 ? 'booking' : 'bookings'}</Link>. This queue is read-only operational visibility; recording return remains the custody-closing action.</p> : null}
      {result.missedPickupCount > 0 && custody !== 'MISSED_PICKUP' ? <p className="sf-field-hint"><Link href={bookingListHref({ page: 1, pageSize, status: 'CONFIRMED', custody: 'MISSED_PICKUP' })}>Review {result.missedPickupCount} missed pickup {result.missedPickupCount === 1 ? 'booking' : 'bookings'}</Link>. This queue is read-only operational visibility; it does not cancel, reschedule, refund, or extend a booking automatically.</p> : null}

      {result.bookings.length === 0 ? <div className="sf-empty-state"><h3>{emptyState.title}</h3><p>{emptyState.description}</p>{custody !== 'ALL' ? <Link className="sf-button sf-button--secondary" href={bookingListHref({ page: 1, pageSize, status: 'ALL', custody: 'ALL' })}>View all rental bookings</Link> : <Link className="sf-button sf-button--primary" href="/inventory/rentals/holds">Review active holds</Link>}</div> : <ul className="sf-inventory-list">{result.bookings.map((booking) => {
        const latestReschedule = booking.reschedules[0];
        const committedStartsOn = latestReschedule?.targetStartsOn ?? booking.startsOn;
        const committedEndsOn = latestReschedule?.targetEndsOn ?? booking.endsOn;
        return <li key={booking.id}><div className="sf-inventory-list__link"><Link className="sf-inventory-list__primary" href={`/inventory/rentals/bookings/${booking.id}`}><div><strong>{booking.customerFirstName} {booking.customerLastName}</strong><span>{booking.allocation ? `${booking.allocation.unit.name} (${booking.allocation.unit.code})` : `${booking.unit.name} (${booking.unit.code})`} · {booking.unitType.name} · {booking.location.name}</span><span>{committedStartsOn.toISOString().slice(0, 10)} through {committedEndsOn.toISOString().slice(0, 10)} (committed, end exclusive)</span>{booking.custody.overdue && booking.custody.expectedReturnOn ? <span><strong>Overdue custody</strong> · exclusive committed end {booking.custody.expectedReturnOn.toISOString().slice(0, 10)} reached; unit remains blocked until return is recorded.</span> : null}{booking.pickup.missed ? <span><strong>Missed pickup</strong> · exclusive committed end {committedEndsOn.toISOString().slice(0, 10)} reached without physical handoff. Review the booking before any further commercial action.</span> : null}{booking.earlyReturnRelease ? <span>Inventory released after early return · protected through {booking.earlyReturnRelease.releasedEndsOn.toISOString().slice(0, 10)}</span> : null}<span>{booking.currency} {moneyMinorToMajorString(booking.totalMinor, booking.currency)} · {booking.status.toLowerCase()}</span></div></Link>{booking.status === 'CONFIRMED' && booking.allocation && booking.fulfillment.state === 'AWAITING_PICKUP' && !booking.pickup.missed && canReviewUnitSubstitution ? <Link className="sf-button sf-button--secondary sf-button--compact" href={`/inventory/rentals/bookings/${booking.id}/unit-substitution`}>Replace unit</Link> : null}</div></li>;
      })}</ul>}

      {result.totalPages > 1 ? <nav className="sf-pagination" aria-label="Rental booking pages">{result.page > 1 ? <Link className="sf-button sf-button--secondary sf-button--compact" href={bookingListHref({ page: result.page - 1, pageSize, status, custody })}>Previous</Link> : <span />}<span>Page {result.page} of {result.totalPages}</span>{result.page < result.totalPages ? <Link className="sf-button sf-button--secondary sf-button--compact" href={bookingListHref({ page: result.page + 1, pageSize, status, custody })}>Next</Link> : <span />}</nav> : null}
    </section>
  </div>;
}
