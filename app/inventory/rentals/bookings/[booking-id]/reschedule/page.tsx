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
  COMMERCIAL_AMENDMENT_ACTIVE: 'This booking already has a prepared commercial amendment. Finish, compensate, or close that retained workflow before reviewing another date change.',
  COMMERCIAL_AMENDMENT_APPLIED: 'This target would change the accepted effective amount after a price-changing amendment was already applied. Another price-changing commercial amendment is not supported; a price-neutral date change can still be reviewed.',
} as const;

const applyErrors: Record<string, string> = {
  permission: 'Your organization role cannot perform this rental date-change action.',
  unavailable: 'The rental booking is no longer available for rescheduling or commercial amendment in this organization.',
  conflict: 'The booking, custody, inventory, pricing, settlement, or review authority changed. Review the target dates again.',
  validation: 'The rental date-change request was invalid. Review the target dates again.',
  server: 'The rental date-change action could not be completed. No successful change was recorded.',
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
    return 'Current target pricing no longer matches the accepted aggregate amount. A supported commercial amendment cannot be prepared from this review.';
  }
  const delta = moneyMinorToMajorString(impact.deltaMinor, impact.acceptedCurrency);
  const targetTotal = moneyMinorToMajorString(impact.targetTotalMinor, impact.targetCurrency);
  return impact.kind === 'INCREASE'
    ? `Current target pricing is ${impact.acceptedCurrency} ${delta} higher, for a target total of ${impact.targetCurrency} ${targetTotal}. Prepare the commercial amendment, retain the exact adjustment, then final apply will revalidate the change.`
    : `Current target pricing is ${impact.acceptedCurrency} ${delta} lower, for a target total of ${impact.targetCurrency} ${targetTotal}. Prepare the commercial amendment, retain the exact refund adjustment, then final apply will revalidate the change.`;
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
  const canPrepareCommercialAmendment = canReview
    && hasPermission('payment:read')
    && hasPermission('payment:manage');

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
      <div><p className="sf-eyebrow">Rental booking</p><h1>{pageTitle}</h1><p>{custodyExtension ? `Review a same-unit extension for ${booking.customerFirstName} ${booking.customerLastName}. The current start date and physical unit stay fixed after pickup; any commercial difference must complete the protected amendment workflow before dates move.` : `Review a same-unit date change for ${booking.customerFirstName} ${booking.customerLastName}. SF shows current target pricing and routes price-neutral and price-changing requests through separate protected write contracts.`}</p></div>
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
      <p className="sf-field-hint">{custodyExtension ? 'Pickup evidence fixes the current start date and physical unit. Review does not reserve the extra days; final write authority always revalidates custody, inventory, and pricing under locks.' : 'Review does not reserve inventory. Any write path performs a second server-side validation under booking and current effective physical-unit locks.'}</p>
    </section>

    {review ? <section className="sf-inventory-card" aria-labelledby="rental-reschedule-result-title">
      <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Authority result</p><h2 id="rental-reschedule-result-title">{review.ready ? custodyExtension ? 'Extension ready to apply' : 'Ready to apply' : review.blocker === 'PRICE_CHANGED' ? 'Commercial amendment required' : custodyExtension ? 'Extension blocked' : 'Target dates blocked'}</h2></div><span>{review.targetPricing.currency} {moneyMinorToMajorString(review.targetPricing.totalMinor, review.targetPricing.currency)}</span></div>
      {review.blocker ? <p className={review.blocker === 'PRICE_CHANGED' ? 'sf-alert' : 'sf-alert sf-alert--error'} role={review.blocker === 'PRICE_CHANGED' ? 'status' : 'alert'}>{rescheduleBlockerMessage(review)}</p> : <p className="sf-alert sf-alert--success" role="status">{custodyExtension ? 'The later end date preserves the current physical unit and accepted effective price, with no conflicting inventory authority.' : 'Inventory and current aggregate pricing are compatible with the supported price-neutral reschedule contract on the current effective unit and accepted effective amount.'}</p>}
      {review.existingCommercialAmendment && hasPermission('payment:read') ? <p><Link className="sf-button sf-button--secondary" href={`/inventory/rentals/bookings/${booking.id}/commercial-amendments/${review.existingCommercialAmendment.id}`}>Open existing commercial amendment</Link></p> : null}
      <ul className="sf-inventory-list">
        <li><div className="sf-inventory-list__primary"><div><strong>Source period</strong><span>{review.booking.startsOn.toISOString().slice(0, 10)} through {review.booking.endsOn.toISOString().slice(0, 10)}</span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>{custodyExtension ? 'Extended period' : 'Target period'}</strong><span>{review.target.startsOn.toISOString().slice(0, 10)} through {review.target.endsOn.toISOString().slice(0, 10)} · {review.target.days} day(s)</span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>Authority mode</strong><span>{review.mode === 'CUSTODY_EXTENSION' ? 'Picked-up same-unit extension' : 'Pre-pickup reschedule'}</span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>Accepted effective amount</strong><span>{review.booking.currency} {moneyMinorToMajorString(review.booking.totalMinor, review.booking.currency)}</span></div></div></li>
        {review.booking.originalTotalMinor !== review.booking.totalMinor ? <li><div className="sf-inventory-list__primary"><div><strong>Original booking amount</strong><span>{review.booking.currency} {moneyMinorToMajorString(review.booking.originalTotalMinor, review.booking.currency)}</span></div></div></li> : null}
        <li><div className="sf-inventory-list__primary"><div><strong>Current target amount</strong><span>{review.targetPricing.currency} {moneyMinorToMajorString(review.targetPricing.totalMinor, review.targetPricing.currency)}</span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>Commercial impact</strong><span>{commercialImpactLabel(review)}</span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>Target pricing fingerprint</strong><span><code>{review.targetPricing.fingerprint}</code></span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>Checked</strong><span><time dateTime={review.checkedAt.toISOString()}>{review.checkedAt.toISOString()}</time></span></div></div></li>
        {review.authorityFingerprint ? <li><div className="sf-inventory-list__primary"><div><strong>Date-change authority fingerprint</strong><span><code>{review.authorityFingerprint}</code></span></div></div></li> : null}
        {review.commercialAmendmentFingerprint ? <li><div className="sf-inventory-list__primary"><div><strong>Commercial review fingerprint</strong><span><code>{review.commercialAmendmentFingerprint}</code></span></div></div></li> : null}
      </ul>

      {review.ready && review.authorityFingerprint && canApply ? <form method="post" action={`/api/inventory/rentals/bookings/${booking.id}/reschedule`} className="sf-inventory-form">
        <input type="hidden" name="startsOn" value={review.target.startsOn.toISOString().slice(0, 10)} />
        <input type="hidden" name="endsOn" value={review.target.endsOn.toISOString().slice(0, 10)} />
        <input type="hidden" name="authorityFingerprint" value={review.authorityFingerprint} />
        <button className="sf-button sf-button--primary" type="submit">{custodyExtension ? 'Apply extension' : 'Apply reschedule'}</button>
      </form> : review.ready ? <p className="sf-field-hint">Your role can review this change but does not include availability management required to apply it.</p> : null}

      {review.blocker === 'PRICE_CHANGED' && review.commercialAmendmentFingerprint
        ? canPrepareCommercialAmendment
          ? <form method="post" action={`/api/inventory/rentals/bookings/${booking.id}/commercial-amendments`} className="sf-inventory-form">
              <input type="hidden" name="startsOn" value={review.target.startsOn.toISOString().slice(0, 10)} />
              <input type="hidden" name="endsOn" value={review.target.endsOn.toISOString().slice(0, 10)} />
              <input type="hidden" name="reviewFingerprint" value={review.commercialAmendmentFingerprint} />
              <p className="sf-field-hint">Preparation retains short-lived server authority only. It does not move booking dates or money. The next screen records exact manual/offline adjustment evidence before final apply.</p>
              <button className="sf-button sf-button--primary" type="submit">Prepare commercial amendment</button>
            </form>
          : <p className="sf-field-hint">This price-changing request is supported, but your role also needs payment read/manage authority to prepare and complete its commercial amendment.</p>
        : null}

      <p className="sf-field-hint">Every apply path remains server-authoritative and rebuilds custody, inventory, pricing, settlement, and retained fingerprints under locks. Unit-type/location changes and currency drift remain unsupported. Price-neutral requests use the direct reschedule writer, including after one applied commercial amendment when they preserve its accepted effective amount; a second price-changing amendment remains closed.</p>
    </section> : null}
  </div>;
}
