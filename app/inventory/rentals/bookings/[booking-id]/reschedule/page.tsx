import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { organizationRoleHasPermission } from '@/server/authorization/authorization-domain.ts';
import { readOrganizationAuthorization } from '@/server/authorization/authorization-service.ts';
import {
  getRentalBooking,
  RentalBookingUnavailableError,
} from '@/server/bookings/rental-booking-read-service.ts';
import {
  reviewRentalBookingRescheduleAuthority,
  RentalBookingRescheduleUnavailableError,
} from '@/server/bookings/rental-booking-reschedule-authority-service.ts';
import { RentalAvailabilityIntegrityError } from '@/server/inventory/rental-availability-domain.ts';
import { RentalInventoryValidationError } from '@/server/inventory/rental-domain.ts';
import { moneyMinorToMajorString } from '@/server/pricing/money.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

const blockerMessages = {
  NO_CHANGE: 'Choose dates that differ from the current effective rental period.',
  INVENTORY_CONFLICT: 'The current physical unit has another live inventory commitment in the requested target range.',
  PRICE_CHANGED: 'Current target-date pricing changes the accepted aggregate amount. Price-changing rental amendments are not implemented.',
} as const;

const applyErrors: Record<string, string> = {
  permission: 'Your organization role cannot apply this rental reschedule.',
  unavailable: 'The rental booking is no longer available for rescheduling in this organization.',
  conflict: 'The booking, inventory, pricing, or review authority changed. Review the target dates again.',
  validation: 'The rental reschedule request was invalid. Review the target dates again.',
  server: 'The rental reschedule could not be completed. No successful reschedule was recorded.',
};

export default async function RentalBookingRescheduleReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ 'booking-id': string }>;
  searchParams: Promise<{ startsOn?: string; endsOn?: string; error?: string }>;
}) {
  const authState = await readAuthSessionState();
  const authRedirect = getAuthRequiredRedirect(authState);
  if (authRedirect) redirect(authRedirect);
  const session = authState.session;
  if (!session) throw new Error('Authenticated rental reschedule review guard returned without a session');

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
  const canReview = hasPermission('booking:manage')
    && hasPermission('availability:read')
    && hasPermission('inventory:read')
    && hasPermission('pricing:read');
  const canApply = canReview && hasPermission('availability:manage');

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
      return <section className="sf-inventory-empty"><p className="sf-eyebrow">Rental reschedule</p><h1>Booking not available</h1><p>This rental booking does not exist in the active organization.</p><Link className="sf-button sf-button--secondary" href="/inventory/rentals/bookings">Back to rental bookings</Link></section>;
    }
    throw error;
  }

  if (!canReview) {
    return <section className="sf-inventory-empty"><p className="sf-eyebrow">Rental reschedule</p><h1>Reschedule review is restricted</h1><p>Your organization role does not include the booking, availability, inventory, and pricing authority required for this review.</p><Link className="sf-button sf-button--secondary" href={`/inventory/rentals/bookings/${booking.id}`}>Back to booking</Link></section>;
  }

  if (booking.status !== 'CONFIRMED' || !booking.allocation) {
    return <section className="sf-inventory-empty"><p className="sf-eyebrow">Rental reschedule</p><h1>Booking is not eligible</h1><p>Only a confirmed rental booking with its retained physical allocation can be reviewed for new dates.</p><Link className="sf-button sf-button--secondary" href={`/inventory/rentals/bookings/${booking.id}`}>Back to booking</Link></section>;
  }

  const requested = Boolean(query.startsOn || query.endsOn);
  let review: Awaited<ReturnType<typeof reviewRentalBookingRescheduleAuthority>> | null = null;
  let reviewError: string | null = null;
  if (query.startsOn && query.endsOn) {
    try {
      review = await reviewRentalBookingRescheduleAuthority({
        organizationId: activeContext.organization.id,
        actorUserId: session.user.id,
        bookingId: booking.id,
        target: { startsOn: query.startsOn, endsOn: query.endsOn },
      });
    } catch (error) {
      if (error instanceof RentalInventoryValidationError) reviewError = error.message;
      else if (error instanceof RentalBookingRescheduleUnavailableError) reviewError = error.message;
      else if (error instanceof RentalAvailabilityIntegrityError) reviewError = 'The booking or rental inventory evidence is inconsistent. Treat this as an integrity incident before rescheduling.';
      else throw error;
    }
  } else if (requested) {
    reviewError = 'Both target start and end dates are required.';
  }

  const defaultStartsOn = query.startsOn ?? booking.allocation.startsOn.toISOString().slice(0, 10);
  const defaultEndsOn = query.endsOn ?? booking.allocation.endsOn.toISOString().slice(0, 10);

  return <div className="sf-inventory-page">
    <header className="sf-inventory-page__header">
      <div><p className="sf-eyebrow">Rental booking</p><h1>Reschedule rental</h1><p>Review and apply a price-neutral date change for {booking.customerFirstName} {booking.customerLastName} on the same physical unit.</p></div>
      <div className="sf-image-scope__nav"><Link className="sf-button sf-button--secondary" href={`/inventory/rentals/bookings/${booking.id}`}>Back to booking</Link><Link className="sf-button sf-button--secondary" href="/inventory/rentals/availability">Availability preview</Link></div>
    </header>

    {query.error && applyErrors[query.error] ? <p className="sf-alert sf-alert--error" role="alert">{applyErrors[query.error]}</p> : null}
    {reviewError ? <p className="sf-alert sf-alert--error" role="alert">{reviewError}</p> : null}

    <section className="sf-inventory-card" aria-labelledby="rental-reschedule-review-title">
      <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Fresh authority</p><h2 id="rental-reschedule-review-title">Target date review</h2></div><span>{booking.unit.name} ({booking.unit.code})</span></div>
      <p>Current effective period: <strong>{booking.allocation.startsOn.toISOString().slice(0, 10)}</strong> through <strong>{booking.allocation.endsOn.toISOString().slice(0, 10)}</strong> (end exclusive). The immutable booking-time period remains retained separately as historical evidence.</p>
      <form method="get" className="sf-inventory-form">
        <label className="sf-field"><span>Target start date</span><input name="startsOn" type="date" required defaultValue={defaultStartsOn} /></label>
        <label className="sf-field"><span>Target end date</span><input name="endsOn" type="date" required defaultValue={defaultEndsOn} /></label>
        <button className="sf-button sf-button--primary" type="submit">Review target dates</button>
      </form>
      <p className="sf-field-hint">The review does not reserve inventory. Apply performs a second server-side validation under booking and physical-unit locks before changing the effective allocation.</p>
    </section>

    {review ? <section className="sf-inventory-card" aria-labelledby="rental-reschedule-result-title">
      <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Authority result</p><h2 id="rental-reschedule-result-title">{review.ready ? 'Ready to apply' : 'Target dates blocked'}</h2></div><span>{review.targetPricing.currency} {moneyMinorToMajorString(review.targetPricing.totalMinor, review.targetPricing.currency)}</span></div>
      {review.blocker ? <p className="sf-alert sf-alert--error" role="alert">{blockerMessages[review.blocker]}</p> : <p className="sf-alert sf-alert--success" role="status">Inventory and current aggregate pricing are compatible with the supported same-unit, price-neutral reschedule contract.</p>}
      <ul className="sf-inventory-list">
        <li><div className="sf-inventory-list__primary"><div><strong>Source period</strong><span>{review.booking.startsOn.toISOString().slice(0, 10)} through {review.booking.endsOn.toISOString().slice(0, 10)}</span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>Target period</strong><span>{review.target.startsOn.toISOString().slice(0, 10)} through {review.target.endsOn.toISOString().slice(0, 10)} · {review.target.days} day(s)</span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>Target pricing fingerprint</strong><span><code>{review.targetPricing.fingerprint}</code></span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>Checked</strong><span><time dateTime={review.checkedAt.toISOString()}>{review.checkedAt.toISOString()}</time></span></div></div></li>
        {review.authorityFingerprint ? <li><div className="sf-inventory-list__primary"><div><strong>Reschedule authority fingerprint</strong><span><code>{review.authorityFingerprint}</code></span></div></div></li> : null}
      </ul>
      {review.ready && review.authorityFingerprint && canApply ? <form method="post" action={`/api/inventory/rentals/bookings/${booking.id}/reschedule`} className="sf-inventory-form">
        <input type="hidden" name="startsOn" value={review.target.startsOn.toISOString().slice(0, 10)} />
        <input type="hidden" name="endsOn" value={review.target.endsOn.toISOString().slice(0, 10)} />
        <input type="hidden" name="authorityFingerprint" value={review.authorityFingerprint} />
        <button className="sf-button sf-button--primary" type="submit">Apply reschedule</button>
      </form> : review.ready ? <p className="sf-field-hint">Your role can review this change but does not include availability management required to apply it.</p> : null}
      <p className="sf-field-hint">Apply remains server-authoritative: it rebuilds inventory and price evidence under locks, writes an append-only reschedule record, moves only the effective allocation dates, versions the booking, and records an audit event. Unit substitution and price-changing amendments remain unsupported.</p>
    </section> : null}
  </div>;
}
