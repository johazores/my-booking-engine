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
  reviewRentalBookingUnitSubstitutionAuthority,
  searchRentalBookingUnitSubstitutionCandidates,
  RentalBookingUnitSubstitutionUnavailableError,
} from '@/server/bookings/rental-booking-unit-substitution-authority-service.ts';
import { RentalBookingUnitSubstitutionValidationError } from '@/server/bookings/rental-booking-unit-substitution-domain.ts';
import { RentalAvailabilityIntegrityError } from '@/server/inventory/rental-availability-domain.ts';
import { moneyMinorToMajorString } from '@/server/pricing/money.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

const blockerMessages = {
  NO_CHANGE: 'Choose a different physical unit.',
  TARGET_UNAVAILABLE: 'The selected unit is not an active same-type unit at the booking operating location in this organization.',
  INVENTORY_CONFLICT: 'The selected unit has another live inventory commitment during the effective rental period.',
} as const;

export default async function RentalBookingUnitSubstitutionReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ 'booking-id': string }>;
  searchParams: Promise<{ q?: string; targetUnitId?: string }>;
}) {
  const authState = await readAuthSessionState();
  const authRedirect = getAuthRequiredRedirect(authState);
  if (authRedirect) redirect(authRedirect);
  const session = authState.session;
  if (!session) throw new Error('Authenticated rental unit substitution review guard returned without a session');

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
    && hasPermission('inventory:read');

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
      return <section className="sf-inventory-empty"><p className="sf-eyebrow">Rental unit substitution</p><h1>Booking not available</h1><p>This rental booking does not exist in the active organization.</p><Link className="sf-button sf-button--secondary" href="/inventory/rentals/bookings">Back to rental bookings</Link></section>;
    }
    throw error;
  }

  if (!canReview) {
    return <section className="sf-inventory-empty"><p className="sf-eyebrow">Rental unit substitution</p><h1>Substitution review is restricted</h1><p>Your organization role does not include the booking, availability, and inventory authority required for this review.</p><Link className="sf-button sf-button--secondary" href={`/inventory/rentals/bookings/${booking.id}`}>Back to booking</Link></section>;
  }

  if (booking.status !== 'CONFIRMED' || !booking.allocation) {
    return <section className="sf-inventory-empty"><p className="sf-eyebrow">Rental unit substitution</p><h1>Booking is not eligible</h1><p>Only a confirmed rental booking with its retained physical allocation can be reviewed for a replacement unit.</p><Link className="sf-button sf-button--secondary" href={`/inventory/rentals/bookings/${booking.id}`}>Back to booking</Link></section>;
  }

  let candidates: Awaited<ReturnType<typeof searchRentalBookingUnitSubstitutionCandidates>> | null = null;
  let review: Awaited<ReturnType<typeof reviewRentalBookingUnitSubstitutionAuthority>> | null = null;
  let reviewError: string | null = null;

  try {
    candidates = await searchRentalBookingUnitSubstitutionCandidates({
      organizationId: activeContext.organization.id,
      actorUserId: session.user.id,
      bookingId: booking.id,
      query: query.q,
    });
    if (query.targetUnitId) {
      review = await reviewRentalBookingUnitSubstitutionAuthority({
        organizationId: activeContext.organization.id,
        actorUserId: session.user.id,
        bookingId: booking.id,
        targetUnitId: query.targetUnitId,
      });
    }
  } catch (error) {
    if (error instanceof RentalBookingUnitSubstitutionValidationError) reviewError = error.message;
    else if (error instanceof RentalBookingUnitSubstitutionUnavailableError) reviewError = error.message;
    else if (error instanceof RentalAvailabilityIntegrityError) reviewError = 'The booking or rental inventory evidence is inconsistent. Treat this as an integrity incident before reviewing a replacement unit.';
    else throw error;
  }

  return <div className="sf-inventory-page">
    <header className="sf-inventory-page__header">
      <div><p className="sf-eyebrow">Rental booking</p><h1>Review replacement unit</h1><p>Preflight a same-type, same-location physical-unit replacement for {booking.customerFirstName} {booking.customerLastName} without changing the accepted rental period or amount.</p></div>
      <div className="sf-image-scope__nav"><Link className="sf-button sf-button--secondary" href={`/inventory/rentals/bookings/${booking.id}`}>Back to booking</Link><Link className="sf-button sf-button--secondary" href="/inventory/rentals/availability">Availability preview</Link></div>
    </header>

    {reviewError ? <p className="sf-alert sf-alert--error" role="alert">{reviewError}</p> : null}

    <section className="sf-inventory-card" aria-labelledby="rental-unit-substitution-candidates-title">
      <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Candidate inventory</p><h2 id="rental-unit-substitution-candidates-title">Choose another physical unit</h2></div><span>{booking.unit.unitType.name}</span></div>
      <p>Current unit: <strong>{booking.unit.name} ({booking.unit.code})</strong>. Effective period: <strong>{booking.allocation.startsOn.toISOString().slice(0, 10)}</strong> through <strong>{booking.allocation.endsOn.toISOString().slice(0, 10)}</strong> (end exclusive).</p>
      <form method="get" className="sf-inventory-form">
        <label className="sf-field"><span>Search same-type units at this location</span><input name="q" type="search" maxLength={80} defaultValue={query.q ?? ''} placeholder="Unit name or code" /></label>
        <button className="sf-button sf-button--secondary" type="submit">Search units</button>
      </form>
      {candidates && candidates.total > 0 ? <form method="get" className="sf-inventory-form">
        {candidates.query ? <input type="hidden" name="q" value={candidates.query} /> : null}
        <label className="sf-field"><span>Replacement unit</span><select name="targetUnitId" required defaultValue={query.targetUnitId ?? ''}><option value="" disabled>Select a physical unit</option>{candidates.candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} ({candidate.code})</option>)}</select></label>
        <button className="sf-button sf-button--primary" type="submit">Review replacement unit</button>
      </form> : <p className="sf-field-hint">No active same-type replacement units match this search at the booking operating location.</p>}
      {candidates && candidates.total > candidates.limit ? <p className="sf-field-hint">Showing the first {candidates.limit} of {candidates.total} matching units. Narrow the search to review another unit.</p> : null}
      <p className="sf-field-hint">Candidate search does not promise availability. The fresh authority review checks blocks, effective holds, and non-cancelled booking allocations for the exact effective rental period.</p>
    </section>

    {review ? <section className="sf-inventory-card" aria-labelledby="rental-unit-substitution-result-title">
      <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Read-only authority</p><h2 id="rental-unit-substitution-result-title">{review.ready ? 'Replacement unit is compatible' : 'Replacement unit is blocked'}</h2></div><span>{review.targetUnit ? `${review.targetUnit.name} (${review.targetUnit.code})` : 'Unavailable target'}</span></div>
      {review.blocker ? <p className="sf-alert sf-alert--error" role="alert">{blockerMessages[review.blocker]}</p> : <p className="sf-alert sf-alert--success" role="status">The target unit is active, matches the retained unit type and operating location, and has no conflicting inventory commitment for the effective rental period.</p>}
      <ul className="sf-inventory-list">
        <li><div className="sf-inventory-list__primary"><div><strong>Effective rental period</strong><span>{review.booking.startsOn.toISOString().slice(0, 10)} through {review.booking.endsOn.toISOString().slice(0, 10)} (end exclusive)</span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>Source unit</strong><span>{review.sourceUnit.name} ({review.sourceUnit.code})</span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>Required product/location match</strong><span>{review.unitType.name} ({review.unitType.code}) · {review.location.name} ({review.location.code})</span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>Accepted amount remains unchanged</strong><span>{review.booking.currency} {moneyMinorToMajorString(review.booking.totalMinor, review.booking.currency)}</span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>Checked</strong><span><time dateTime={review.checkedAt.toISOString()}>{review.checkedAt.toISOString()}</time></span></div></div></li>
        {review.authorityFingerprint ? <li><div className="sf-inventory-list__primary"><div><strong>Substitution authority fingerprint</strong><span><code>{review.authorityFingerprint}</code></span></div></div></li> : null}
      </ul>
      <p className="sf-field-hint">This is a read-only preflight. It does not reserve the target unit, change the booking, or move the allocation. SF will not expose an Apply action until an append-only substitution record, dual-unit write serialization, stale-authority protection, database allocation guards, idempotency, and audit semantics are implemented together.</p>
    </section> : null}
  </div>;
}
