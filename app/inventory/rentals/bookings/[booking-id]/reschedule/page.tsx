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
  CUSTODY_EXTENSION_REQUIRED: 'After pickup, the current start date is fixed. Only a later committed end date can be reviewed.',
  INVENTORY_CONFLICT: 'The current effective physical unit has another live inventory commitment in the requested target range.',
  CURRENCY_CHANGED: 'The current unit-type currency no longer matches the accepted booking currency. Correct the pricing configuration before changing this rental period.',
} as const;

const applyErrors: Record<string, string> = {
  permission: 'Your organization role cannot apply this rental date change.',
  unavailable: 'The rental booking is no longer available for rescheduling or extension in this organization.',
  conflict: 'The booking, custody, inventory, pricing, or review authority changed. Review the target dates again.',
  validation: 'The rental date-change request was invalid. Review the target dates again.',
  server: 'The rental date change could not be completed. No successful change was recorded.',
};

type RescheduleReview = Awaited<ReturnType<typeof reviewRentalBookingRescheduleAuthority>>;

function commercialImpactLabel(review: RescheduleReview) {
  const impact = review.commercialImpact;
  if (impact.kind === 'CURRENCY_CHANGED') {
    return `Currency changed from ${impact.acceptedCurrency} to ${impact.targetCurrency}`;
  }
  if (impact.kind === 'UNCHANGED') return 'No aggregate price change';
  const delta = moneyMinorToMajorString(impact.deltaMinor, impact.acceptedCurrency);
  return impact.kind === 'INCREASE'
    ? `Increase of ${impact.acceptedCurrency} ${delta}`
    : `Decrease of ${impact.acceptedCurrency} ${delta}`;
}

function rescheduleBlockerMessage(review: RescheduleReview) {
  if (!review.blocker) return null;
  if (review.blocker !== 'PRICE_CHANGED') return blockerMessages[review.blocker];

  const impact = review.commercialImpact;
  if (impact.kind !== 'INCREASE' && impact.kind !== 'DECREASE') {
    return 'Current target pricing no longer matches the accepted aggregate amount. A separate commercial amendment is required before this date change can be applied.';
  }
  const delta = moneyMinorToMajorString(impact.deltaMinor, impact.acceptedCurrency);
  const targetTotal = moneyMinorToMajorString(impact.targetTotalMinor, impact.targetCurrency);
  return impact.kind === 'INCREASE'
    ? `Current target pricing is ${impact.acceptedCurrency} ${delta} higher, for a target total of ${impact.targetCurrency} ${targetTotal}. Applying this date change requires a separate commercial amendment and settlement workflow.`
    : `Current target pricing is ${impact.acceptedCurrency} ${delta} lower, for a target total of ${impact.targetCurrency} ${targetTotal}. Applying this date change requires a separate commercial amendment and settlement workflow.`;
}

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
      return <section className="sf-inventory-empty"><p className="sf-eyebrow">Rental date change</p><h1>Booking not available</h1><p>This rental booking does not exist in the active organization.</p><Link className="sf-button sf-button--secondary" href="/inventory/rentals/bookings">Back to rental bookings</Link></section>;
    }
    throw error;
  }

  if (!canReview) {
    return <section className="sf-inventory-empty"><p className="sf-eyebrow">Rental date change</p><h1>Date-change review is restricted</h1><p>Your organization role does not include the booking, availability, inventory, and pricing authority required for this review.</p><Link className="sf-button sf-button--secondary" href={`/inventory/rentals/bookings/${booking.id}`}>Back to booking</Link></section>;
  }

  if (
    booking.status !== 'CONFIRMED'
    || !booking.allocation
    || booking.fulfillment.state === 'RETURNED'
  ) {
    return <section className="sf-inventory-empty"><p className="sf-eyebrow">Rental date change</p><h1>Booking is not eligible</h1><p>Only a confirmed rental with its retained physical allocation and no recorded return can be reviewed. Picked-up rentals may only extend their current committed end date.</p><Link className="sf-button sf-button--secondary" href={`/inventory/rentals/bookings/${booking.id}`}>Back to booking</Link></section>;
  }

  const custodyExtension = booking.fulfillment.state === 'PICKED_UP';
  const requested = Boolean(query.startsOn || query.endsOn);
  let review: RescheduleReview | null = null;
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
      else if (error instanceof RentalAvailabilityIntegrityError) reviewError = 'The booking or rental inventory evidence is inconsistent. Treat this as an integrity incident before changing dates.';
      else throw error;
    }
  } else if (requested) {
    reviewError = 'Both target start and end dates are required.';
  }

  const currentStartsOn = booking.allocation.startsOn.toISOString().slice(0, 10);
  const currentEndsOn = booking.allocation.endsOn.toISOString().slice(0, 10);
  const minimumExtendedEndsOn = new Date(booking.allocation.endsOn.getTime() + 86_400_000).toISOString().slice(0, 10);
  const defaultStartsOn = custodyExtension ? currentStartsOn : query.startsOn ?? currentStartsOn;
  const defaultEndsOn = query.endsOn ?? currentEndsOn;
  const pageTitle = custodyExtension ? 'Extend rental' : 'Reschedule rental';

  return <div className="sf-inventory-page">
    <header className="sf-inventory-page__header">
      <div><p className="sf-eyebrow">Rental booking</p><h1>{pageTitle}</h1><p>{custodyExtension ? `Review a same-unit extension for ${booking.customerFirstName} ${booking.customerLastName}. The current start date and physical unit stay fixed after pickup; any commercial difference is shown before apply remains blocked.` : `Review a same-unit date change for ${booking.customerFirstName} ${booking.customerLastName}. SF shows current target pricing and the exact commercial difference before deciding whether the supported price-neutral apply path is available.`}</p></div>
      <div className="sf-image-scope__nav"><Link className="sf-button sf-button--secondary" href={`/inventory/rentals/bookings/${booking.id}`}>Back to booking</Link><Link className="sf-button sf-button--secondary" href="/inventory/rentals/availability">Availability preview</Link></div>
    </header>

    {query.error && applyErrors[query.error] ? <p className="sf-alert sf-alert--error" role="alert">{applyErrors[query.error]}</p> : null}
    {reviewError ? <p className="sf-alert sf-alert--error" role="alert">{reviewError}</p> : null}

    <section className="sf-inventory-card" aria-labelledby="rental-reschedule-review-title">
      <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Fresh authority</p><h2 id="rental-reschedule-review-title">{custodyExtension ? 'Extension review' : 'Target date review'}</h2></div><span>{booking.allocation.unit.name} ({booking.allocation.unit.code})</span></div>
      <p>Current effective period: <strong>{currentStartsOn}</strong> through <strong>{currentEndsOn}</strong> (end exclusive). Original booking-time period, unit, and accepted commercial evidence remain retained separately as history.</p>
      <form method="get" className="sf-inventory-form">
        {custodyExtension
          ? <label className="sf-field"><span>Committed start date</span><input type="date" value={currentStartsOn} readOnly aria-readonly="true" /><input name="startsOn" type="hidden" value={currentStartsOn} /></label>
          : <label className="sf-field"><span>Target start date</span><input name="startsOn" type="date" required defaultValue={defaultStartsOn} /></label>}
        <label className="sf-field"><span>{custodyExtension ? 'Extended end date' : 'Target end date'}</span><input name="endsOn" type="date" required defaultValue={defaultEndsOn} min={custodyExtension ? minimumExtendedEndsOn : undefined} /></label>
        <button className="sf-button sf-button--primary" type="submit">{custodyExtension ? 'Review extension' : 'Review target dates'}</button>
      </form>
      <p className="sf-field-hint">{custodyExtension ? 'Pickup evidence fixes the current start date and physical unit. Review does not reserve the extra days; Apply revalidates custody, inventory, and pricing under booking/unit locks before extending the effective allocation.' : 'The review does not reserve inventory. Apply performs a second server-side validation under booking and current effective physical-unit locks before changing the effective allocation dates.'}</p>
    </section>

    {review ? <section className="sf-inventory-card" aria-labelledby="rental-reschedule-result-title">
      <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Authority result</p><h2 id="rental-reschedule-result-title">{review.ready ? custodyExtension ? 'Extension ready to apply' : 'Ready to apply' : custodyExtension ? 'Extension blocked' : 'Target dates blocked'}</h2></div><span>{review.targetPricing.currency} {moneyMinorToMajorString(review.targetPricing.totalMinor, review.targetPricing.currency)}</span></div>
      {review.blocker ? <p className="sf-alert sf-alert--error" role="alert">{rescheduleBlockerMessage(review)}</p> : <p className="sf-alert sf-alert--success" role="status">{custodyExtension ? 'The later end date preserves the current physical unit and accepted aggregate price, with no conflicting inventory authority.' : 'Inventory and current aggregate pricing are compatible with the supported price-neutral reschedule contract on the current effective unit.'}</p>}
      <ul className="sf-inventory-list">
        <li><div className="sf-inventory-list__primary"><div><strong>Source period</strong><span>{review.booking.startsOn.toISOString().slice(0, 10)} through {review.booking.endsOn.toISOString().slice(0, 10)}</span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>{custodyExtension ? 'Extended period' : 'Target period'}</strong><span>{review.target.startsOn.toISOString().slice(0, 10)} through {review.target.endsOn.toISOString().slice(0, 10)} · {review.target.days} day(s)</span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>Authority mode</strong><span>{review.mode === 'CUSTODY_EXTENSION' ? 'Picked-up same-unit extension' : 'Pre-pickup reschedule'}</span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>Accepted booking amount</strong><span>{review.booking.currency} {moneyMinorToMajorString(review.booking.totalMinor, review.booking.currency)}</span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>Current target amount</strong><span>{review.targetPricing.currency} {moneyMinorToMajorString(review.targetPricing.totalMinor, review.targetPricing.currency)}</span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>Commercial impact</strong><span>{commercialImpactLabel(review)}</span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>Target pricing fingerprint</strong><span><code>{review.targetPricing.fingerprint}</code></span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>Checked</strong><span><time dateTime={review.checkedAt.toISOString()}>{review.checkedAt.toISOString()}</time></span></div></div></li>
        {review.authorityFingerprint ? <li><div className="sf-inventory-list__primary"><div><strong>Date-change authority fingerprint</strong><span><code>{review.authorityFingerprint}</code></span></div></div></li> : null}
      </ul>
      {review.ready && review.authorityFingerprint && canApply ? <form method="post" action={`/api/inventory/rentals/bookings/${booking.id}/reschedule`} className="sf-inventory-form">
        <input type="hidden" name="startsOn" value={review.target.startsOn.toISOString().slice(0, 10)} />
        <input type="hidden" name="endsOn" value={review.target.endsOn.toISOString().slice(0, 10)} />
        <input type="hidden" name="authorityFingerprint" value={review.authorityFingerprint} />
        <button className="sf-button sf-button--primary" type="submit">{custodyExtension ? 'Apply extension' : 'Apply reschedule'}</button>
      </form> : review.ready ? <p className="sf-field-hint">Your role can review this change but does not include availability management required to apply it.</p> : null}
      <p className="sf-field-hint">Apply remains server-authoritative: it rebuilds custody, inventory, and price evidence under locks, writes append-only reschedule evidence, moves only effective allocation dates, versions the booking, and records an audit event. After pickup only the current-start/later-end extension shape is accepted. Unit-type/location changes remain unsupported. Same-currency price changes are reviewed with an exact server-derived delta but require a separate commercial amendment/settlement contract before they can be applied; currency drift must be corrected as pricing configuration.</p>
    </section> : null}
  </div>;
}
