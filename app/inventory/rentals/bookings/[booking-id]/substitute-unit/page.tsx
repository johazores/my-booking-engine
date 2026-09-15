import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { organizationRoleHasPermission } from '@/server/authorization/authorization-domain.ts';
import { readOrganizationAuthorization } from '@/server/authorization/authorization-service.ts';
import {
  listRentalBookingUnitSubstitutionCandidates,
  reviewRentalBookingUnitSubstitutionAuthority,
  RentalBookingUnitSubstitutionUnavailableError,
} from '@/server/bookings/rental-booking-unit-substitution-authority-service.ts';
import { RentalAvailabilityIntegrityError } from '@/server/inventory/rental-availability-domain.ts';
import { moneyMinorToMajorString } from '@/server/pricing/money.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

const errors: Record<string, string> = {
  permission: 'Your organization role cannot substitute rental units.',
  conflict: 'The booking or inventory changed. Review the target unit again.',
  unavailable: 'This rental booking is no longer available for unit substitution.',
  validation: 'Choose a valid target physical unit.',
  server: 'The physical-unit substitution could not be completed.',
};

const blockerMessages = {
  NO_CHANGE: 'Choose a different physical unit from the one currently allocated.',
  INCOMPATIBLE_UNIT: 'The selected unit is not an active unit of the same booked unit type and operating location.',
  INVENTORY_CONFLICT: 'The selected unit is blocked, held, or already allocated for the effective rental period.',
} as const;

export default async function RentalBookingUnitSubstitutionPage({
  params,
  searchParams,
}: {
  params: Promise<{ 'booking-id': string }>;
  searchParams: Promise<{ targetUnitId?: string; error?: string }>;
}) {
  const authState = await readAuthSessionState();
  const authRedirect = getAuthRequiredRedirect(authState);
  if (authRedirect) redirect(authRedirect);
  const session = authState.session;
  if (!session) throw new Error('Authenticated rental unit substitution guard returned without a session');

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
  const canReview = hasPermission('booking:manage')
    && hasPermission('availability:read')
    && hasPermission('inventory:read');
  const canApply = canReview && hasPermission('availability:manage');
  if (!canReview) {
    return <section className="sf-inventory-empty"><p className="sf-eyebrow">Rental booking</p><h1>Unit substitution is restricted</h1><p>Your organization role does not include the required booking, availability, and inventory access.</p></section>;
  }

  const routeParams = await params;
  const query = await searchParams;
  const bookingId = routeParams['booking-id'];
  let candidates: Awaited<ReturnType<typeof listRentalBookingUnitSubstitutionCandidates>>;
  try {
    candidates = await listRentalBookingUnitSubstitutionCandidates({
      organizationId: activeContext.organization.id,
      actorUserId: session.user.id,
      bookingId,
    });
  } catch (error) {
    if (error instanceof RentalBookingUnitSubstitutionUnavailableError) {
      return <section className="sf-inventory-empty"><p className="sf-eyebrow">Rental booking</p><h1>Unit substitution unavailable</h1><p>This booking is not a confirmed rental with a retained effective allocation in the active organization.</p><Link className="sf-button sf-button--secondary" href={`/inventory/rentals/bookings/${bookingId}`}>Back to booking</Link></section>;
    }
    throw error;
  }

  let review: Awaited<ReturnType<typeof reviewRentalBookingUnitSubstitutionAuthority>> | null = null;
  let reviewError: string | null = null;
  if (query.targetUnitId) {
    try {
      review = await reviewRentalBookingUnitSubstitutionAuthority({
        organizationId: activeContext.organization.id,
        actorUserId: session.user.id,
        bookingId,
        target: { targetUnitId: query.targetUnitId },
      });
    } catch (error) {
      if (
        error instanceof RentalBookingUnitSubstitutionUnavailableError
        || error instanceof RentalAvailabilityIntegrityError
      ) {
        reviewError = error.message;
      } else {
        reviewError = 'The target unit could not be reviewed. Choose a valid compatible unit and try again.';
      }
    }
  }

  return <div className="sf-inventory-page">
    <header className="sf-inventory-page__header">
      <div><p className="sf-eyebrow">Rental booking</p><h1>Substitute physical unit</h1><p>Move the effective allocation to another active unit of the same booked type and operating location without changing dates or accepted money.</p></div>
      <div className="sf-image-scope__nav"><Link className="sf-button sf-button--secondary" href={`/inventory/rentals/bookings/${bookingId}`}>Back to booking</Link></div>
    </header>

    {query.error && errors[query.error] ? <p className="sf-alert sf-alert--error" role="alert">{errors[query.error]}</p> : null}
    {reviewError ? <p className="sf-alert sf-alert--error" role="alert">{reviewError}</p> : null}

    <section className="sf-inventory-card" aria-labelledby="unit-substitution-review-title">
      <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Fresh authority</p><h2 id="unit-substitution-review-title">Review target unit</h2></div><span>{candidates.units.length} compatible candidate{candidates.units.length === 1 ? '' : 's'}</span></div>
      <p className="sf-field-hint">Review does not reserve or move inventory. Apply reacquires booking plus source/target unit locks and rechecks every conflict before the allocation changes.</p>
      {candidates.units.length === 0 ? <div className="sf-empty-state"><h3>No compatible physical units</h3><p>No other active unit currently exists for this booking's unit type and operating location.</p></div> : <form method="get" className="sf-form-row">
        <label className="sf-field">Target physical unit<select name="targetUnitId" required defaultValue={query.targetUnitId ?? ''}><option value="" disabled>Choose a unit</option>{candidates.units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name} ({unit.code})</option>)}</select></label>
        <button className="sf-button sf-button--secondary" type="submit">Review target unit</button>
      </form>}
    </section>

    {review ? <section className="sf-inventory-card" aria-labelledby="unit-substitution-result-title">
      <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Authority result</p><h2 id="unit-substitution-result-title">{review.ready ? 'Ready to substitute' : 'Substitution blocked'}</h2></div><span>{review.checkedAt.toISOString()}</span></div>
      <ul className="sf-inventory-list">
        <li><div className="sf-inventory-list__primary"><div><strong>Current unit</strong><span>{review.sourceUnit.name} ({review.sourceUnit.code})</span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>Target unit</strong><span>{review.targetUnit ? `${review.targetUnit.name} (${review.targetUnit.code})` : 'Unavailable or incompatible'}</span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>Effective rental period</strong><span>{review.booking.startsOn.toISOString().slice(0, 10)} through {review.booking.endsOn.toISOString().slice(0, 10)} (end exclusive)</span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>Accepted amount remains unchanged</strong><span>{review.booking.currency} {moneyMinorToMajorString(review.booking.totalMinor, review.booking.currency)}</span></div></div></li>
      </ul>
      {review.blocker ? <p className="sf-alert sf-alert--error" role="alert">{blockerMessages[review.blocker]}</p> : null}
      {review.ready && review.authorityFingerprint && review.targetUnit ? canApply ? <form method="post" action={`/api/inventory/rentals/bookings/${bookingId}/substitute-unit`}>
        <input type="hidden" name="targetUnitId" value={review.targetUnit.id} />
        <input type="hidden" name="authorityFingerprint" value={review.authorityFingerprint} />
        <button className="sf-button sf-button--primary" type="submit">Apply unit substitution</button>
        <p className="sf-field-hint">This changes only the effective physical allocation. Original booking-time unit evidence remains immutable and the change is recorded append-only.</p>
      </form> : <p className="sf-alert sf-alert--error" role="alert">The review is ready, but your role does not include availability write authority required to move committed inventory.</p> : null}
    </section> : null}
  </div>;
}
