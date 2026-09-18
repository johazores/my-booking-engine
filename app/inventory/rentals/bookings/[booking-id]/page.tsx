import Link from 'next/link';
import { redirect } from 'next/navigation';

import { RentalBookingCancelAction } from '@/components/rental-booking-cancel-action.tsx';
import { RentalBookingPaymentPanel } from '@/components/rental-booking-payment-panel.tsx';
import { RentalReturnInspectionPanel } from '@/components/rental-return-inspection-panel.tsx';
import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { organizationRoleHasPermission } from '@/server/authorization/authorization-domain.ts';
import { readOrganizationAuthorization } from '@/server/authorization/authorization-service.ts';
import { deriveRentalBookingEarlyReturnReleaseEndsOn } from '@/server/bookings/rental-booking-early-return-release-domain.ts';
import { deriveRentalBookingPickupWindow } from '@/server/bookings/rental-booking-pickup-window-domain.ts';
import { getRentalBooking, RentalBookingUnavailableError } from '@/server/bookings/rental-booking-read-service.ts';
import { listRentalBookingPaymentTransactions, RentalPaymentUnavailableError } from '@/server/payments/rental-payment-service.ts';
import { moneyMinorToMajorString } from '@/server/pricing/money.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

const statuses: Record<string, string> = {
  'booking-confirmed': 'Rental booking confirmed and physical inventory committed.',
  'booking-existing': 'This confirmation request already completed earlier. The existing rental booking is shown below.',
  'booking-cancelled': 'Rental booking cancelled. Its physical unit and date range are available for new inventory decisions again.',
  'booking-already-cancelled': 'This rental booking was already cancelled. No duplicate lifecycle change was applied.',
  'booking-rescheduled': 'Rental booking rescheduled. The effective physical-unit allocation now uses the reviewed target dates.',
  'booking-extended': 'Rental booking extended. The effective physical-unit allocation now protects the reviewed later committed end date.',
  'booking-reschedule-existing': 'This rental date-change request already completed earlier. The current effective rental period is shown below.',
  'booking-unit-substituted': 'Rental booking physical unit replaced. The new effective unit now protects the current rental period.',
  'booking-unit-substitution-existing': 'This replacement request already completed earlier. The current effective booking is shown below.',
  'rental-payment-recorded': 'Rental offline payment recorded against the current accepted booking balance.',
  'rental-payment-existing': 'This rental offline payment was already recorded earlier. No duplicate transaction was created.',
  'rental-refund-recorded': 'Rental offline refund recorded against the server-selected retained payment source.',
  'rental-refund-existing': 'This rental offline refund was already recorded earlier. No duplicate transaction was created.',
  'rental-picked-up': 'Rental pickup recorded. Cancellation and unit replacement are now locked; authorized staff may still review a same-unit price-neutral extension until return.',
  'rental-pickup-existing': 'Rental pickup was already recorded earlier. No duplicate custody event was created.',
  'rental-returned': 'Rental return recorded. The immutable pickup and return custody evidence is retained.',
  'rental-return-existing': 'Rental return was already recorded earlier. No duplicate custody event was created.',
  'rental-inventory-released': 'Remaining whole-day inventory after the recorded early return is now available for new inventory decisions again.',
  'rental-inventory-release-existing': 'This early-return inventory release was already applied earlier. No duplicate release evidence was created.',
};

const errors: Record<string, string> = {
  permission: 'Your organization role cannot change this rental booking.',
  conflict: 'The rental booking changed or its retained allocation is inconsistent. Refresh the booking before trying again.',
  'pickup-window': 'Pickup is available only during the committed rental dates at the retained operating location. Refresh the booking and review its current period before handing over the unit.',
  unavailable: 'This rental booking is no longer available in the active organization.',
  validation: 'The rental booking request was invalid.',
  server: 'The rental booking change could not be completed. No successful change was recorded.',
  'payment-permission': 'Your organization role cannot record rental payments or refunds.',
  'payment-conflict': 'The rental payment history or booking state changed. Review the current settlement before trying again.',
  'payment-unavailable': 'This rental booking is no longer available for payment operations in the active organization.',
  'payment-validation': 'The rental payment amount or reference was invalid.',
  'payment-server': 'The rental payment operation could not be completed. No successful transaction was recorded.',
};

export default async function RentalBookingDetailPage({ params, searchParams }: {
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
  const authorization = await readOrganizationAuthorization({ organizationId: activeContext.organization.id, userId: session.user.id });
  const hasPermission = (permission: Parameters<typeof organizationRoleHasPermission>[1]) => Boolean(
    authorization.platformAdmin || (authorization.role && organizationRoleHasPermission(authorization.role, permission)),
  );
  const canRead = hasPermission('booking:read');
  const canReadAvailability = hasPermission('availability:read');
  const canReadInventory = hasPermission('inventory:read');
  const canReadPricing = hasPermission('pricing:read');
  const canManageBooking = hasPermission('booking:manage');
  const canManageAvailability = hasPermission('availability:manage');
  const canManageInventory = hasPermission('inventory:manage');
  const canReadPayments = hasPermission('payment:read');
  const canManagePayments = hasPermission('payment:manage');
  if (!canRead) return <section className="sf-inventory-empty"><p className="sf-eyebrow">Rental bookings</p><h1>Booking access is restricted</h1><p>Your organization role does not include booking access.</p></section>;

  const routeParams = await params;
  const query = await searchParams;
  let booking: Awaited<ReturnType<typeof getRentalBooking>>;
  try {
    booking = await getRentalBooking({ organizationId: activeContext.organization.id, actorUserId: session.user.id, bookingId: routeParams['booking-id'] });
  } catch (error) {
    if (error instanceof RentalBookingUnavailableError) {
      return <section className="sf-inventory-empty"><p className="sf-eyebrow">Rental bookings</p><h1>Booking not available</h1><p>This rental booking does not exist in the active organization.</p><Link className="sf-button sf-button--secondary" href="/inventory/rentals/bookings">Back to rental bookings</Link></section>;
    }
    throw error;
  }

  let paymentData: Awaited<ReturnType<typeof listRentalBookingPaymentTransactions>> | null = null;
  if (canReadPayments) {
    try {
      paymentData = await listRentalBookingPaymentTransactions({ organizationId: activeContext.organization.id, actorUserId: session.user.id, bookingId: booking.id, pageSize: 100 });
    } catch (error) {
      if (!(error instanceof RentalPaymentUnavailableError)) throw error;
    }
  }

  const beforePickup = booking.fulfillment.state === 'AWAITING_PICKUP';
  const inCustody = booking.fulfillment.state === 'PICKED_UP';
  const canReviewCancellation = booking.status === 'CONFIRMED' && beforePickup && Boolean(booking.allocation) && canManageBooking && canManageAvailability;
  const canReviewReschedule = booking.status === 'CONFIRMED' && (beforePickup || inCustody) && Boolean(booking.allocation) && canManageBooking && canReadAvailability && canReadInventory && canReadPricing;
  const canReviewUnitSubstitutionPermission = booking.status === 'CONFIRMED' && beforePickup && Boolean(booking.allocation) && canManageBooking && canReadAvailability && canReadInventory;
  const canFulfill = booking.status === 'CONFIRMED' && Boolean(booking.allocation) && canManageBooking && canManageInventory;
  const latestReschedule = booking.reschedules.at(-1);
  const committedStartsOn = latestReschedule?.targetStartsOn ?? booking.startsOn;
  const committedEndsOn = latestReschedule?.targetEndsOn ?? booking.endsOn;
  const pickupWindow = deriveRentalBookingPickupWindow({
    observedAt: booking.custody.observedAt,
    startsOn: committedStartsOn,
    endsOn: committedEndsOn,
    timeZone: booking.location.timeZone,
  });
  const canReviewUnitSubstitution = canReviewUnitSubstitutionPermission && pickupWindow.state !== 'CLOSED';
  const canRecordPickup = canFulfill
    && beforePickup
    && pickupWindow.state === 'OPEN';
  const inventoryEndsOn = booking.allocation?.endsOn ?? committedEndsOn;
  const effectiveUnit = booking.allocation?.unit ?? booking.unit;
  const returnEvent = booking.fulfillmentEvents.find((event) => event.kind === 'RETURNED') ?? null;
  const releaseCandidateEndsOn = !booking.earlyReturnRelease && returnEvent
    ? deriveRentalBookingEarlyReturnReleaseEndsOn({
        returnedAt: returnEvent.occurredAt,
        committedStartsOn,
        committedEndsOn,
        timeZone: booking.location.timeZone,
      })
    : null;
  const canReleaseRemainingInventory = canFulfill
    && booking.fulfillment.state === 'RETURNED'
    && !booking.earlyReturnRelease
    && releaseCandidateEndsOn !== null;

  return <div className="sf-inventory-page">
    <header className="sf-inventory-page__header">
      <div><p className="sf-eyebrow">Rental booking</p><h1>{booking.customerFirstName} {booking.customerLastName}</h1><p>Durable booking, settlement, fulfillment, and physical-unit allocation evidence for {activeContext.organization.name}.</p></div>
      <div className="sf-image-scope__nav"><Link className="sf-button sf-button--secondary" href="/inventory/rentals/bookings">Rental bookings</Link>{canReadAvailability ? <Link className="sf-button sf-button--secondary" href={`/inventory/rentals/holds/${booking.holdId}`}>Source hold</Link> : null}{canReadInventory && booking.allocation ? <Link className="sf-button sf-button--secondary" href={`/inventory/rentals/units/${booking.allocation.unitId}`}>Effective unit</Link> : null}{canReviewReschedule ? <Link className="sf-button sf-button--secondary" href={`/inventory/rentals/bookings/${booking.id}/reschedule`}>{beforePickup ? 'Reschedule rental' : 'Extend rental'}</Link> : null}{canReviewUnitSubstitution ? <Link className="sf-button sf-button--secondary" href={`/inventory/rentals/bookings/${booking.id}/unit-substitution`}>Replace unit</Link> : null}</div>
    </header>

    {query.status && statuses[query.status] ? <p className="sf-alert sf-alert--success" role="status">{statuses[query.status]}</p> : null}
    {query.error && errors[query.error] ? <p className="sf-alert sf-alert--error" role="alert">{errors[query.error]}</p> : null}
    {!booking.allocation ? <p className="sf-alert sf-alert--error" role="alert">This booking is missing its physical-unit allocation. Treat the record as an integrity incident until repaired.</p> : null}
    {booking.custody.overdue && booking.custody.expectedReturnOn ? <p className="sf-alert sf-alert--error" role="alert"><strong>Overdue custody.</strong> The exclusive committed end {booking.custody.expectedReturnOn.toISOString().slice(0, 10)} has been reached in {booking.location.timeZone}, but return has not been recorded. The physical unit remains blocked from new inventory authority until return is recorded. This status does not create a fee or change the committed rental period.</p> : null}

    <section className="sf-inventory-card" aria-labelledby="rental-booking-lifecycle-title">
      <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Lifecycle</p><h2 id="rental-booking-lifecycle-title">Booking commitment</h2></div><span>{booking.status}</span></div>
      <ul className="sf-inventory-list">
        <li><div className="sf-inventory-list__primary"><div><strong>Committed rental period</strong><span>{committedStartsOn.toISOString().slice(0, 10)} through {committedEndsOn.toISOString().slice(0, 10)} (end exclusive)</span></div></div></li>
        {booking.reschedules.length > 0 ? <li><div className="sf-inventory-list__primary"><div><strong>Original booking-time period</strong><span>{booking.startsOn.toISOString().slice(0, 10)} through {booking.endsOn.toISOString().slice(0, 10)} · retained immutable evidence</span></div></div></li> : null}
        <li><div className="sf-inventory-list__primary"><div><strong>Confirmed</strong><span><time dateTime={booking.confirmedAt.toISOString()}>{booking.confirmedAt.toISOString()}</time></span></div></div></li>
        {booking.cancelledAt ? <li><div className="sf-inventory-list__primary"><div><strong>Cancelled</strong><span><time dateTime={booking.cancelledAt.toISOString()}>{booking.cancelledAt.toISOString()}</time></span></div></div></li> : null}
        <li><div className="sf-inventory-list__primary"><div><strong>Effective physical allocation</strong><span>{booking.allocation ? booking.status === 'CANCELLED' ? `${effectiveUnit.name} (${effectiveUnit.code}) allocation is retained as historical evidence and no longer protects live availability.` : `${effectiveUnit.name} (${effectiveUnit.code}) is the current physical assignment.` : 'Allocation missing'}</span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>Live inventory protection</strong><span>{booking.status === 'CANCELLED' ? 'Released by cancellation.' : `${committedStartsOn.toISOString().slice(0, 10)} through ${inventoryEndsOn.toISOString().slice(0, 10)} (end exclusive)`}</span></div></div></li>
        {booking.earlyReturnRelease ? <li><div className="sf-inventory-list__primary"><div><strong>Early-return inventory release</strong><span>Committed end {booking.earlyReturnRelease.committedEndsOn.toISOString().slice(0, 10)} retained; inventory protection shortened to {booking.earlyReturnRelease.releasedEndsOn.toISOString().slice(0, 10)} after return.</span><span>Released <time dateTime={booking.earlyReturnRelease.releasedAt.toISOString()}>{booking.earlyReturnRelease.releasedAt.toISOString()}</time> · append-only evidence</span></div></div></li> : null}
        {booking.unitSubstitutions.length > 0 ? <li><div className="sf-inventory-list__primary"><div><strong>Original booking-time unit</strong><span>{booking.unit.name} ({booking.unit.code}) · retained immutable evidence</span></div></div></li> : null}
        <li><div className="sf-inventory-list__primary"><div><strong>Operating location</strong><span>{booking.location.name} ({booking.location.code}) · {booking.location.city}, {booking.location.countryCode} · {booking.location.timeZone}</span></div></div></li>
      </ul>
      <p className="sf-field-hint">Before pickup and before the committed pickup window closes, authorized staff can apply supported reschedules, unit substitutions, settlement/refunds, and cancellation. Once pickup is recorded, cancellation and unit replacement fail closed; date changes narrow to a same-unit, same-start, later-end price-neutral custody extension until return. After a missed pickup, unit replacement also closes; staff must review the supported reschedule or cancellation path. Return records custody handback and closes further date changes; a separate explicit release can free only complete remaining rental days without changing accepted money or the committed rental period.</p>
    </section>

    {booking.status === 'CONFIRMED' ? <section className="sf-inventory-card" aria-labelledby="rental-booking-fulfillment-title">
      <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Physical custody</p><h2 id="rental-booking-fulfillment-title">Rental fulfillment</h2></div><span>{booking.custody.overdue ? 'OVERDUE CUSTODY' : beforePickup && pickupWindow.state === 'CLOSED' ? 'MISSED PICKUP' : booking.fulfillment.state.replaceAll('_', ' ')}</span></div>
      {booking.fulfillmentEvents.length > 0 ? <ul className="sf-inventory-list">{booking.fulfillmentEvents.map((event) => <li key={event.id}><div className="sf-inventory-list__primary"><div><strong>{event.kind === 'PICKED_UP' ? 'Picked up' : 'Returned'}</strong><span>{event.unitName} ({event.unitCode}) · {event.startsOn.toISOString().slice(0, 10)} through {event.endsOn.toISOString().slice(0, 10)}</span><span><time dateTime={event.occurredAt.toISOString()}>{event.occurredAt.toISOString()}</time> · immutable custody evidence</span></div></div></li>)}</ul> : <p className="sf-field-hint">No physical custody transfer has been recorded. The booking remains eligible for supported pre-pickup commercial and inventory changes while its committed pickup window remains open.</p>}
      {canRecordPickup ? <form method="post" action={`/api/inventory/rentals/bookings/${booking.id}/pickup`}><button className="sf-button sf-button--primary" type="submit">Record pickup</button></form> : null}
      {canFulfill && beforePickup && pickupWindow.state === 'BEFORE_WINDOW' ? <p className="sf-field-hint">Pickup opens on {committedStartsOn.toISOString().slice(0, 10)} in {booking.location.timeZone}. The server will not record custody before the committed rental starts.</p> : null}
      {beforePickup && pickupWindow.state === 'CLOSED' ? <p className="sf-alert sf-alert--error" role="status"><strong>Missed pickup.</strong> The exclusive committed end {committedEndsOn.toISOString().slice(0, 10)} has been reached in {booking.location.timeZone}. Do not hand over or replace the unit under this expired rental period; review the supported reschedule or cancellation path instead.</p> : null}
      {canFulfill && booking.fulfillment.state === 'PICKED_UP' ? <form method="post" action={`/api/inventory/rentals/bookings/${booking.id}/return`}><button className="sf-button sf-button--primary" type="submit">Record return</button></form> : null}
      {canReleaseRemainingInventory ? <form method="post" action={`/api/inventory/rentals/bookings/${booking.id}/inventory-release`} aria-describedby="rental-early-return-release-hint"><button className="sf-button sf-button--primary" type="submit">Release remaining inventory</button></form> : null}
      {canReleaseRemainingInventory && releaseCandidateEndsOn ? <p id="rental-early-return-release-hint" className="sf-field-hint">This will make the effective unit available from {releaseCandidateEndsOn.toISOString().slice(0, 10)} onward. The committed rental end, accepted amount, payment evidence, and custody history remain unchanged.</p> : null}
      <p className="sf-field-hint">Pickup and return timestamps come from PostgreSQL time and the committed unit/date assignment is snapshotted server-side. Pickup is allowed only from the committed start date until the exclusive committed end in the retained operating-location timezone. Return does not release inventory before the booking's effective end date by itself. After an early return, authorized staff may explicitly release only complete rental days after the return day.</p>
    </section> : null}

    <RentalReturnInspectionPanel
      organizationId={activeContext.organization.id}
      actorUserId={session.user.id}
      bookingId={booking.id}
      fulfillmentState={booking.fulfillment.state}
      canManage={canManageBooking && canManageInventory}
    />

    {paymentData ? <RentalBookingPaymentPanel bookingId={booking.id} bookingStatus={booking.status} bookingCurrency={booking.currency} settlement={paymentData.settlement} transactions={paymentData.transactions} canManage={canManagePayments} /> : null}

    {booking.unitSubstitutions.length > 0 ? <section className="sf-inventory-card" aria-labelledby="rental-booking-unit-substitution-history-title">
      <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Append-only history</p><h2 id="rental-booking-unit-substitution-history-title">Physical-unit substitution evidence</h2></div><span>{booking.unitSubstitutions.length} applied</span></div>
      <ul className="sf-inventory-list">{booking.unitSubstitutions.map((substitution) => <li key={substitution.id}><div className="sf-inventory-list__primary"><div><strong>{substitution.sourceUnit.name} ({substitution.sourceUnit.code}) → {substitution.targetUnit.name} ({substitution.targetUnit.code})</strong><span>{substitution.startsOn.toISOString().slice(0, 10)} through {substitution.endsOn.toISOString().slice(0, 10)} · accepted {substitution.currency} {moneyMinorToMajorString(substitution.totalMinor, substitution.currency)}</span><span>Authority <code>{substitution.authorityFingerprint}</code> · applied <time dateTime={substitution.appliedAt.toISOString()}>{substitution.appliedAt.toISOString()}</time></span></div></div></li>)}</ul>
    </section> : null}

    {booking.reschedules.length > 0 ? <section className="sf-inventory-card" aria-labelledby="rental-booking-reschedule-history-title">
      <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Append-only history</p><h2 id="rental-booking-reschedule-history-title">Reschedule and extension evidence</h2></div><span>{booking.reschedules.length} applied</span></div>
      <ul className="sf-inventory-list">{booking.reschedules.map((reschedule) => <li key={reschedule.id}><div className="sf-inventory-list__primary"><div><strong>{reschedule.sourceStartsOn.toISOString().slice(0, 10)} → {reschedule.targetStartsOn.toISOString().slice(0, 10)}</strong><span>{reschedule.sourceStartsOn.toISOString().slice(0, 10)} through {reschedule.sourceEndsOn.toISOString().slice(0, 10)} became {reschedule.targetStartsOn.toISOString().slice(0, 10)} through {reschedule.targetEndsOn.toISOString().slice(0, 10)}</span><span>Pricing fingerprint <code>{reschedule.targetPricingFingerprint}</code> · applied <time dateTime={reschedule.appliedAt.toISOString()}>{reschedule.appliedAt.toISOString()}</time></span></div></div></li>)}</ul>
    </section> : null}

    {booking.status === 'CONFIRMED' && inCustody ? <p className="sf-alert sf-alert--error" role="status">Pickup has been recorded. Cancellation and physical-unit replacement are locked to preserve custody evidence. Authorized staff may still review a same-unit, same-start, later-end price-neutral extension until return.</p> : null}
    {booking.status === 'CONFIRMED' && booking.fulfillment.state === 'RETURNED' ? <p className="sf-alert sf-alert--error" role="status">Return has been recorded. Cancellation, further date changes, and physical-unit replacement are locked to preserve completed custody evidence.</p> : null}
    {canReviewCancellation ? <section className="sf-inventory-card" aria-labelledby="rental-booking-cancel-title"><div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Inventory release</p><h2 id="rental-booking-cancel-title">Cancel rental booking</h2></div></div><RentalBookingCancelAction bookingId={booking.id} bookingCurrency={booking.currency} settlement={paymentData?.settlement ?? null} /></section> : null}

    <section className="sf-inventory-card" aria-labelledby="rental-booking-customer-title">
      <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Immutable snapshot</p><h2 id="rental-booking-customer-title">Customer evidence</h2></div><span>{booking.customer.status.toLowerCase()} profile</span></div>
      <ul className="sf-inventory-list"><li><div className="sf-inventory-list__primary"><div><strong>{booking.customerFirstName} {booking.customerLastName}</strong><span>{booking.customerEmail ?? 'No email snapshot'} · {booking.customerPhone ?? 'No phone snapshot'}</span></div></div></li><li><div className="sf-inventory-list__primary"><div><strong>Customer reference</strong><span><code>{booking.customerId}</code></span></div></div></li></ul>
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
