import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { organizationRoleHasPermission } from '@/server/authorization/authorization-domain.ts';
import { readOrganizationAuthorization } from '@/server/authorization/authorization-service.ts';
import {
  listRentalBookings,
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

function bookingListHref(input: Readonly<{
  page: number;
  pageSize: number;
  status: RentalBookingListStatus;
}>) {
  const params = new URLSearchParams();
  if (input.page > 1) params.set('page', String(input.page));
  if (input.pageSize !== 20) params.set('pageSize', String(input.pageSize));
  if (input.status !== 'ALL') params.set('status', input.status.toLowerCase());
  const query = params.toString();
  return query ? `/inventory/rentals/bookings?${query}` : '/inventory/rentals/bookings';
}

export default async function RentalBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; pageSize?: string; status?: string }>;
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
  const result = await listRentalBookings({
    organizationId: activeContext.organization.id,
    actorUserId: session.user.id,
    status,
    page: parseInventoryPage(params.page),
    pageSize,
  });

  return <div className="sf-inventory-page">
    <header className="sf-inventory-page__header">
      <div><p className="sf-eyebrow">Rental operations</p><h1>Rental bookings</h1><p>Review durable physical-unit commitments created from revalidated rental holds for {activeContext.organization.name}.</p></div>
      <div className="sf-image-scope__nav"><Link className="sf-button sf-button--primary" href="/inventory/rentals/holds">Active holds</Link><Link className="sf-button sf-button--secondary" href="/inventory/rentals/availability">Availability preview</Link><Link className="sf-button sf-button--secondary" href="/inventory/rentals">Rental inventory</Link></div>
    </header>

    <section className="sf-inventory-card" aria-labelledby="rental-booking-filter-title">
      <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">History</p><h2 id="rental-booking-filter-title">Booking records</h2></div><span>{result.total} matching</span></div>
      <form method="get" className="sf-form-row">
        <label className="sf-field">Status<select name="status" defaultValue={status.toLowerCase()}><option value="all">All</option><option value="confirmed">Confirmed</option><option value="cancelled">Cancelled</option></select></label>
        <label className="sf-field">Rows per page<select name="pageSize" defaultValue={String(pageSize)}><option value="20">20</option><option value="50">50</option><option value="100">100</option></select></label>
        <button className="sf-button sf-button--secondary" type="submit">Apply filters</button>
      </form>
      <p className="sf-field-hint">A confirmed rental booking means SF has committed the physical unit under reviewed commercial evidence. The displayed period is the current effective allocation after any supported price-neutral reschedules.</p>

      {result.bookings.length === 0 ? <div className="sf-empty-state"><h3>No rental bookings match this filter</h3><p>Bookings appear only after an effective hold and active customer pass the server-side conversion review and atomic confirmation boundary.</p><Link className="sf-button sf-button--primary" href="/inventory/rentals/holds">Review active holds</Link></div> : <ul className="sf-inventory-list">{result.bookings.map((booking) => <li key={booking.id}><div className="sf-inventory-list__link"><Link className="sf-inventory-list__primary" href={`/inventory/rentals/bookings/${booking.id}`}><div><strong>{booking.customerFirstName} {booking.customerLastName}</strong><span>{booking.unit.name} ({booking.unit.code}) · {booking.unitType.name} · {booking.location.name}</span><span>{booking.allocation ? `${booking.allocation.startsOn.toISOString().slice(0, 10)} through ${booking.allocation.endsOn.toISOString().slice(0, 10)} (end exclusive)` : 'Physical allocation missing'}</span><span>{booking.currency} {moneyMinorToMajorString(booking.totalMinor, booking.currency)} · {booking.status.toLowerCase()}</span></div></Link>{booking.status === 'CONFIRMED' && booking.allocation && canReviewUnitSubstitution ? <Link className="sf-button sf-button--secondary sf-button--compact" href={`/inventory/rentals/bookings/${booking.id}/unit-substitution`}>Review replacement</Link> : null}</div></li>)}</ul>}

      {result.totalPages > 1 ? <nav className="sf-pagination" aria-label="Rental booking pages">{result.page > 1 ? <Link className="sf-button sf-button--secondary sf-button--compact" href={bookingListHref({ page: result.page - 1, pageSize, status })}>Previous</Link> : <span />}<span>Page {result.page} of {result.totalPages}</span>{result.page < result.totalPages ? <Link className="sf-button sf-button--secondary sf-button--compact" href={bookingListHref({ page: result.page + 1, pageSize, status })}>Next</Link> : <span />}</nav> : null}
    </section>
  </div>;
}
