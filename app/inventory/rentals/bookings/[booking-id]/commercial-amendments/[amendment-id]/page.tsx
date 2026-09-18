import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { organizationRoleHasPermission } from '@/server/authorization/authorization-domain.ts';
import { readOrganizationAuthorization } from '@/server/authorization/authorization-service.ts';
import { readRentalBookingCommercialAmendmentSettlement } from '@/server/bookings/rental-booking-commercial-amendment-settlement-service.ts';
import { RentalBookingCommercialAmendmentUnavailableError } from '@/server/bookings/rental-booking-commercial-amendment-service.ts';
import { readRentalBookingEffectiveSettlement } from '@/server/bookings/rental-booking-effective-settlement-service.ts';
import { getRentalBooking, RentalBookingUnavailableError } from '@/server/bookings/rental-booking-read-service.ts';
import { listRentalBookingPaymentTransactions } from '@/server/payments/rental-payment-service.ts';
import { moneyMinorToMajorString } from '@/server/pricing/money.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

const statusMessages: Record<string, string> = {
  'amendment-prepared': 'Commercial amendment prepared. Record the exact real-world adjustment before final apply.',
  'amendment-existing': 'The matching commercial amendment was already prepared.',
  'settlement-recorded': 'Adjustment settlement evidence recorded.',
  'settlement-existing': 'The matching adjustment settlement evidence was already recorded.',
  'compensation-recorded': 'Compensation evidence recorded. The adjustment has been fully reversed.',
  'compensation-existing': 'The matching compensation evidence was already recorded.',
  'amendment-applied': 'Commercial amendment applied. Effective dates and combined settlement now use the retained amendment evidence.',
  'apply-existing': 'This commercial amendment was already applied.',
  'amendment-closed': 'Commercial amendment closed without apply.',
  'amendment-expired': 'Commercial amendment authority expired and was closed.',
  'close-existing': 'This commercial amendment was already terminal.',
  'refund-recorded': 'Post-apply refund evidence recorded against the server-selected source.',
  'refund-existing': 'The matching post-apply refund evidence was already recorded.',
};

const errorMessages: Record<string, string> = {
  permission: 'Your organization role does not include the authority required for this commercial action.',
  unavailable: 'This rental commercial amendment is no longer available in the active organization.',
  conflict: 'Commercial authority changed or retained evidence no longer reconciles. Review the current state before continuing.',
  validation: 'The submitted commercial action is invalid. Check the required reference, amount, or confirmation and try again.',
  server: 'The commercial action could not be completed. No successful change was recorded.',
};

const dateKey = (value: Date) => value.toISOString().slice(0, 10);

export default async function RentalCommercialAmendmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ 'booking-id': string; 'amendment-id': string }>;
  searchParams: Promise<{ status?: string; error?: string }>;
}) {
  const authState = await readAuthSessionState();
  const authRedirect = getAuthRequiredRedirect(authState);
  if (authRedirect) redirect(authRedirect);
  const session = authState.session;
  if (!session) throw new Error('Authenticated rental commercial amendment guard returned without a session');

  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) redirect('/inventory?error=tenant');
  const authorization = await readOrganizationAuthorization({ organizationId: activeContext.organization.id, userId: session.user.id });
  const hasPermission = (permission: Parameters<typeof organizationRoleHasPermission>[1]) => Boolean(
    authorization.platformAdmin || (authorization.role && organizationRoleHasPermission(authorization.role, permission)),
  );
  const canRead = hasPermission('booking:read') && hasPermission('payment:read');
  const canManage = hasPermission('booking:manage') && hasPermission('payment:manage');
  const canApply = canManage && hasPermission('availability:read') && hasPermission('availability:manage') && hasPermission('inventory:read') && hasPermission('pricing:read');

  if (!canRead) {
    return <section className="sf-inventory-empty"><p className="sf-eyebrow">Rental commercial amendment</p><h1>Commercial access is restricted</h1><p>Your role needs booking and payment read access.</p><Link className="sf-button sf-button--secondary" href="/inventory/rentals/bookings">Back to rental bookings</Link></section>;
  }

  const routeParams = await params;
  const query = await searchParams;
  const bookingId = routeParams['booking-id'];
  const amendmentId = routeParams['amendment-id'];
  let booking: Awaited<ReturnType<typeof getRentalBooking>>;
  let commercial: Awaited<ReturnType<typeof readRentalBookingCommercialAmendmentSettlement>>;
  try {
    [booking, commercial] = await Promise.all([
      getRentalBooking({ organizationId: activeContext.organization.id, actorUserId: session.user.id, bookingId }),
      readRentalBookingCommercialAmendmentSettlement({ organizationId: activeContext.organization.id, actorUserId: session.user.id, bookingId, amendmentId }),
    ]);
  } catch (error) {
    if (error instanceof RentalBookingUnavailableError || error instanceof RentalBookingCommercialAmendmentUnavailableError) {
      return <section className="sf-inventory-empty"><p className="sf-eyebrow">Rental commercial amendment</p><h1>Commercial amendment not available</h1><p>The booking or amendment is not available in this organization.</p><Link className="sf-button sf-button--secondary" href="/inventory/rentals/bookings">Back to rental bookings</Link></section>;
    }
    throw error;
  }

  const amendment = commercial.amendment;
  if (amendment.bookingId !== booking.id) throw new RentalBookingCommercialAmendmentUnavailableError();
  const prepared = amendment.status === 'PREPARED';
  const preparationLive = prepared && amendment.expiresAt.getTime() > Date.now();
  const actionUrl = `/api/inventory/rentals/bookings/${booking.id}/commercial-amendments/${amendment.id}`;
  const delta = moneyMinorToMajorString(amendment.deltaMinor, amendment.currency);

  let paymentSources: Awaited<ReturnType<typeof listRentalBookingPaymentTransactions>> | null = null;
  if (prepared && commercial.settlement.state === 'UNSETTLED' && amendment.direction === 'REFUND') {
    paymentSources = await listRentalBookingPaymentTransactions({
      organizationId: activeContext.organization.id,
      actorUserId: session.user.id,
      bookingId,
      page: 1,
      pageSize: 100,
    });
  }
  const manualSources = paymentSources?.transactions.filter((row) => row.kind === 'OFFLINE_PAYMENT' && row.status === 'SUCCEEDED' && row.providerCode === 'manual' && row.currency === amendment.currency) ?? [];
  const sourceListComplete = !paymentSources || paymentSources.totalPages <= 1;

  const effective = amendment.status === 'APPLIED'
    ? await readRentalBookingEffectiveSettlement({ organizationId: activeContext.organization.id, actorUserId: session.user.id, bookingId })
    : null;
  const effectiveSettlement = effective?.settlement ?? null;
  const refundable = effectiveSettlement?.reconciled && effectiveSettlement.appliedAmendment?.id === amendment.id && effectiveSettlement.currentNetSettledMinor > 0n && effectiveSettlement.nextRefundSource
    ? effectiveSettlement
    : null;
  const refundMaximum = refundable?.nextRefundSource
    ? (refundable.nextRefundSource.refundableMinor < refundable.currentNetSettledMinor ? refundable.nextRefundSource.refundableMinor : refundable.currentNetSettledMinor)
    : 0n;

  return <div className="sf-inventory-page">
    <header className="sf-inventory-page__header">
      <div><p className="sf-eyebrow">Rental commercial amendment</p><h1>{booking.customerFirstName} {booking.customerLastName}</h1><p>Complete the retained same-unit price-changing date workflow without rewriting the immutable booking-time amount.</p></div>
      <div className="sf-image-scope__nav"><Link className="sf-button sf-button--secondary" href={`/inventory/rentals/bookings/${booking.id}`}>Back to booking</Link><Link className="sf-button sf-button--secondary" href={`/inventory/rentals/bookings/${booking.id}/reschedule`}>Date-change review</Link></div>
    </header>

    {query.status && statusMessages[query.status] ? <p className="sf-alert sf-alert--success" role="status">{statusMessages[query.status]}</p> : null}
    {query.error && errorMessages[query.error] ? <p className="sf-alert sf-alert--error" role="alert">{errorMessages[query.error]}</p> : null}

    <section className="sf-inventory-card" aria-labelledby="commercial-summary-title">
      <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Retained authority</p><h2 id="commercial-summary-title">{amendment.status.toLowerCase()} · {commercial.settlement.state.toLowerCase()}</h2></div><span>{amendment.direction === 'ADDITIONAL_CHARGE' ? 'Additional charge' : 'Refund'} {amendment.currency} {delta}</span></div>
      <ul className="sf-inventory-list">
        <li><div className="sf-inventory-list__primary"><div><strong>Source period</strong><span>{dateKey(amendment.sourceStartsOn)} through {dateKey(amendment.sourceEndsOn)}</span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>Target period</strong><span>{dateKey(amendment.targetStartsOn)} through {dateKey(amendment.targetEndsOn)}</span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>Accepted total</strong><span>{amendment.currency} {moneyMinorToMajorString(amendment.beforeTotalMinor, amendment.currency)}</span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>Target total</strong><span>{amendment.currency} {moneyMinorToMajorString(amendment.afterTotalMinor, amendment.currency)}</span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>Prepared authority expires</strong><span><time dateTime={amendment.expiresAt.toISOString()}>{amendment.expiresAt.toISOString()}</time></span></div></div></li>
      </ul>
      {commercial.transactions.length ? <ul className="sf-inventory-list">{commercial.transactions.map((row) => <li key={row.id}><div className="sf-inventory-list__primary"><div><strong>{row.purpose.toLowerCase()} · {row.kind.toLowerCase()}</strong><span>{row.currency} {moneyMinorToMajorString(row.amountMinor, row.currency)} · {row.providerCode} · {row.providerReference}</span></div></div></li>)}</ul> : <p className="sf-field-hint">No adjustment money evidence has been retained yet.</p>}
    </section>

    {prepared && commercial.settlement.state === 'UNSETTLED' && canManage ? <section className="sf-inventory-card" aria-labelledby="adjustment-title">
      <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Step 1</p><h2 id="adjustment-title">Record exact adjustment</h2></div><span>{amendment.currency} {delta}</span></div>
      {!preparationLive ? <p className="sf-alert sf-alert--error" role="alert">Preparation expired. Do not move new adjustment money; close this amendment instead.</p>
        : amendment.direction === 'ADDITIONAL_CHARGE' ? <form className="sf-inventory-form" method="post" action={actionUrl}>
            <input type="hidden" name="operation" value="settle" />
            <label className="sf-field"><span>Offline collection reference</span><input name="reference" maxLength={120} required autoComplete="off" /></label>
            <p className="sf-field-hint">Record only after the exact {amendment.currency} {delta} was actually collected outside SF. This form never collects money.</p>
            <button className="sf-button sf-button--primary" type="submit">Record adjustment payment</button>
          </form>
        : !sourceListComplete ? <p className="sf-alert sf-alert--error" role="alert">The bounded staff view cannot enumerate the complete original payment history, so source selection fails closed.</p>
        : manualSources.length === 0 ? <p className="sf-alert sf-alert--error" role="alert">No retained successful manual booking-price payment source is available for this exact refund.</p>
        : <form className="sf-inventory-form" method="post" action={actionUrl}>
            <input type="hidden" name="operation" value="settle" />
            <label className="sf-field"><span>Original payment source</span><select name="sourceProviderReference" required defaultValue=""><option value="" disabled>Select retained manual payment</option>{manualSources.map((source) => <option key={source.id} value={source.providerReference}>{source.providerReference} · {source.currency} {moneyMinorToMajorString(source.amountMinor, source.currency)}</option>)}</select></label>
            <label className="sf-field"><span>Offline refund reference</span><input name="reference" maxLength={120} required autoComplete="off" /></label>
            <p className="sf-field-hint">Record only after the exact refund was issued outside SF. The server independently rechecks remaining source capacity.</p>
            <button className="sf-button sf-button--primary" type="submit">Record adjustment refund</button>
          </form>}
    </section> : null}

    {prepared && commercial.settlement.state === 'SETTLED' ? <section className="sf-inventory-card" aria-labelledby="finalize-title">
      <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Step 2</p><h2 id="finalize-title">Finalize or reverse</h2></div><span>Adjustment retained</span></div>
      {preparationLive && canApply ? <form className="sf-inventory-form" method="post" action={actionUrl}>
        <input type="hidden" name="operation" value="apply" />
        <p>Final apply re-locks and revalidates booking version, custody, inventory, pricing, allocation, and exact settlement before moving dates.</p>
        <label className="sf-field"><span>Confirmation</span><input name="confirmation" placeholder="APPLY" pattern="[Aa][Pp][Pp][Ll][Yy]" required autoComplete="off" /></label>
        <button className="sf-button sf-button--primary" type="submit">Apply commercial date change</button>
      </form> : <p className="sf-alert sf-alert--error" role="alert">Final apply is unavailable because authority expired or your role lacks the required availability/inventory/pricing permissions.</p>}
      {canManage ? <form className="sf-inventory-form" method="post" action={actionUrl}>
        <input type="hidden" name="operation" value="compensate" />
        <label className="sf-field"><span>Offline compensation reference</span><input name="reference" maxLength={120} required autoComplete="off" /></label>
        <p className="sf-field-hint">Use only after the adjustment was fully reversed outside SF. Compensation records the exact opposite movement and never changes booking dates.</p>
        <button className="sf-button sf-button--danger" type="submit">Record full compensation</button>
      </form> : null}
    </section> : null}

    {prepared && (commercial.settlement.state === 'UNSETTLED' || commercial.settlement.state === 'COMPENSATED') && canManage ? <section className="sf-inventory-card">
      <p>{commercial.settlement.state === 'COMPENSATED' ? 'The adjustment was fully reversed.' : 'No adjustment money is retained.'} Closing preserves history without moving booking dates.</p>
      <form method="post" action={actionUrl}><input type="hidden" name="operation" value="close" /><button className="sf-button sf-button--secondary" type="submit">{preparationLive ? 'Close amendment' : 'Record expired amendment'}</button></form>
    </section> : null}

    {amendment.status === 'APPLIED' ? <section className="sf-inventory-card" aria-labelledby="effective-title">
      <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Post-apply</p><h2 id="effective-title">Effective settlement</h2></div></div>
      {!effectiveSettlement ? <p className="sf-alert sf-alert--error" role="alert">Effective settlement is unavailable.</p>
        : !effectiveSettlement.reconciled ? <p className="sf-alert sf-alert--error" role="alert">{effectiveSettlement.reason}</p>
        : <>
          <ul className="sf-inventory-list">
            <li><div className="sf-inventory-list__primary"><div><strong>Effective accepted total</strong><span>{effectiveSettlement.currency} {moneyMinorToMajorString(effectiveSettlement.effectiveAcceptedTotalMinor, effectiveSettlement.currency)}</span></div></div></li>
            <li><div className="sf-inventory-list__primary"><div><strong>Current settled balance</strong><span>{effectiveSettlement.currency} {moneyMinorToMajorString(effectiveSettlement.currentNetSettledMinor, effectiveSettlement.currency)}</span></div></div></li>
            {effectiveSettlement.nextRefundSource ? <li><div className="sf-inventory-list__primary"><div><strong>Next refund source</strong><span>{effectiveSettlement.nextRefundSource.sourceLedger === 'COMMERCIAL_AMENDMENT' ? 'Amendment payment' : 'Original booking payment'} · {effectiveSettlement.nextRefundSource.providerReference}</span></div></div></li> : null}
          </ul>
          {effectiveSettlement.fullyRefunded ? <p className="sf-alert sf-alert--success" role="status">Combined effective settlement is exactly zero. Cancellation may proceed from booking detail if its remaining guards pass.</p>
            : refundable && canManage ? <form className="sf-inventory-form" method="post" action={actionUrl}>
                <input type="hidden" name="operation" value="refund" />
                <label className="sf-field"><span>Offline refund amount ({refundable.currency})</span><input name="amount" inputMode="decimal" required defaultValue={moneyMinorToMajorString(refundMaximum, refundable.currency)} /></label>
                <label className="sf-field"><span>Offline refund reference</span><input name="reference" maxLength={120} required autoComplete="off" /></label>
                <p className="sf-field-hint">The server selects the retained source and caps one refund to {refundable.currency} {moneyMinorToMajorString(refundMaximum, refundable.currency)}. Record only after the real refund happened outside SF.</p>
                <button className="sf-button sf-button--primary" type="submit">Record post-apply refund</button>
              </form>
            : <p className="sf-field-hint">Remaining effective money must be reconciled before exact-zero cancellation.</p>}
        </>}
    </section> : null}

    {(amendment.status === 'CANCELLED' || amendment.status === 'EXPIRED') ? <section className="sf-inventory-card"><p className="sf-alert sf-alert--success" role="status">This amendment is terminal. Retained evidence remains read-only for audit history.</p></section> : null}
  </div>;
}
