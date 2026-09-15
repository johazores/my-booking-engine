import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { organizationRoleHasPermission } from '@/server/authorization/authorization-domain.ts';
import { readOrganizationAuthorization } from '@/server/authorization/authorization-service.ts';
import { reviewRentalBookingConversionAuthority } from '@/server/bookings/rental-booking-authority-service.ts';
import { listCustomers } from '@/server/customers/customer-service.ts';
import { RentalAvailabilityIntegrityError } from '@/server/inventory/rental-availability-domain.ts';
import { readRentalAvailabilityHoldPricingReview } from '@/server/inventory/rental-hold-service.ts';
import { RentalInventoryUnavailableError } from '@/server/inventory/rental-service.ts';
import { moneyMinorToMajorString } from '@/server/pricing/money.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

const errors: Record<string, string> = {
  permission: 'You do not have permission to confirm this rental booking.',
  conflict: 'The rental hold, pricing, customer, or inventory changed before confirmation. Review the current evidence again.',
  unavailable: 'The rental hold or customer is no longer available for booking confirmation.',
  validation: 'The rental booking confirmation request is invalid. Review the customer and hold again.',
  server: 'The rental booking could not be confirmed. Try again after reviewing the current evidence.',
};

function pricingStateMessage(state: 'CURRENT' | 'CHANGED' | 'LEGACY') {
  if (state === 'CURRENT') {
    return 'Current configured pricing still matches the quote observed when this hold was created.';
  }
  if (state === 'CHANGED') {
    return 'Configured pricing changed after this hold was created. Any booking confirmation must use freshly revalidated pricing; the hold never locked the earlier amount.';
  }
  return 'This hold predates durable pricing evidence and cannot be converted into a rental booking.';
}

function conversionBlockerMessage(blocker: 'LEGACY_PRICING_EVIDENCE' | 'PRICE_CHANGED' | 'INVENTORY_CONFLICT' | null) {
  if (blocker === 'LEGACY_PRICING_EVIDENCE') return 'This legacy hold has no complete immutable pricing evidence and cannot be converted.';
  if (blocker === 'PRICE_CHANGED') return 'Current pricing no longer matches the hold observation. Release this hold and create a fresh reviewed hold before booking.';
  if (blocker === 'INVENTORY_CONFLICT') return 'The physical unit now conflicts with another inventory commitment and cannot be confirmed from this hold.';
  return null;
}

function customerSelectionHref(holdId: string, customerId: string, customerSearch: string) {
  const params = new URLSearchParams({ customerId });
  if (customerSearch) params.set('customerSearch', customerSearch);
  return `/inventory/rentals/holds/${holdId}?${params.toString()}`;
}

export default async function RentalAvailabilityHoldDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ 'hold-id': string }>;
  searchParams: Promise<{ customerId?: string; customerSearch?: string; error?: string }>;
}) {
  const authState = await readAuthSessionState();
  const authRedirect = getAuthRequiredRedirect(authState);
  if (authRedirect) redirect(authRedirect);
  const session = authState.session;
  if (!session) throw new Error('Authenticated rental hold detail guard returned without a session');

  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) redirect('/inventory?error=tenant');
  const routeParams = await params;
  const query = await searchParams;

  const authorization = await readOrganizationAuthorization({
    organizationId: activeContext.organization.id,
    userId: session.user.id,
  });
  const hasPermission = (permission: Parameters<typeof organizationRoleHasPermission>[1]) => Boolean(
    authorization.platformAdmin
      || (authorization.role && organizationRoleHasPermission(authorization.role, permission)),
  );
  const canReadAvailability = hasPermission('availability:read');
  const canReadPricing = hasPermission('pricing:read');
  const canManageAvailability = hasPermission('availability:manage');
  const canReadInventory = hasPermission('inventory:read');
  const canReadCustomers = hasPermission('customer:read');
  const canManageBookings = hasPermission('booking:manage');
  const canReviewConversion = canReadAvailability && canReadPricing && canReadInventory && canReadCustomers && canManageBookings;
  const canConfirmConversion = canReviewConversion && canManageAvailability;
  if (!canReadAvailability || !canReadPricing) {
    return <section className="sf-inventory-empty"><p className="sf-eyebrow">Rental availability</p><h1>Hold review is restricted</h1><p>Your organization role needs both availability and pricing read access to review rental hold pricing evidence.</p></section>;
  }

  let pricingReview: Awaited<ReturnType<typeof readRentalAvailabilityHoldPricingReview>>;
  try {
    pricingReview = await readRentalAvailabilityHoldPricingReview({
      organizationId: activeContext.organization.id,
      actorUserId: session.user.id,
      holdId: routeParams['hold-id'],
    });
  } catch (error) {
    if (error instanceof RentalInventoryUnavailableError) {
      return <section className="sf-inventory-empty"><p className="sf-eyebrow">Rental availability</p><h1>Hold not available</h1><p>This rental hold does not exist in the active organization.</p><Link className="sf-button sf-button--secondary" href="/inventory/rentals/holds">Back to active holds</Link></section>;
    }
    throw error;
  }

  const customerSearch = (query.customerSearch ?? '').trim().slice(0, 120);
  const customerResults = canReviewConversion && pricingReview.effective
    ? await listCustomers({
        organizationId: activeContext.organization.id,
        actorUserId: session.user.id,
        search: customerSearch,
        status: 'ACTIVE',
        sort: 'name-asc',
        page: 1,
        pageSize: 25,
      })
    : null;

  let conversionReview: Awaited<ReturnType<typeof reviewRentalBookingConversionAuthority>> | null = null;
  let conversionError: string | null = null;
  if (canReviewConversion && pricingReview.effective && query.customerId) {
    try {
      conversionReview = await reviewRentalBookingConversionAuthority({
        organizationId: activeContext.organization.id,
        actorUserId: session.user.id,
        holdId: routeParams['hold-id'],
        customerId: query.customerId,
      });
    } catch (error) {
      if (error instanceof RentalInventoryUnavailableError) {
        conversionError = 'The selected customer or hold is no longer active in this organization.';
      } else if (error instanceof RentalAvailabilityIntegrityError) {
        conversionError = 'Rental pricing or inventory evidence is incomplete and cannot safely authorize a booking.';
      } else {
        throw error;
      }
    }
  }

  const hold = pricingReview.hold;
  const blockerMessage = conversionReview ? conversionBlockerMessage(conversionReview.blocker) : null;
  return <div className="sf-inventory-page">
    <header className="sf-inventory-page__header">
      <div><p className="sf-eyebrow">Rental availability</p><h1>{hold.unit.name}</h1><p>Review inventory protection and current pricing evidence, then explicitly bind an active tenant customer before confirming a durable rental booking.</p></div>
      <div className="sf-image-scope__nav"><Link className="sf-button sf-button--secondary" href="/inventory/rentals/holds">Active holds</Link><Link className="sf-button sf-button--secondary" href="/inventory/rentals/bookings">Rental bookings</Link><Link className="sf-button sf-button--secondary" href="/inventory/rentals/availability">Availability preview</Link></div>
    </header>

    {query.error && errors[query.error] ? <p className="sf-alert sf-alert--error" role="alert">{errors[query.error]}</p> : null}
    <p className={`sf-alert ${pricingReview.pricingState === 'CURRENT' ? 'sf-alert--success' : 'sf-alert--error'}`} role="status">{pricingStateMessage(pricingReview.pricingState)}</p>

    <section className="sf-inventory-card" aria-labelledby="rental-hold-detail-title">
      <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Inventory protection</p><h2 id="rental-hold-detail-title">Hold details</h2></div><span>{pricingReview.effective ? 'Effective' : hold.status}</span></div>
      <ul className="sf-inventory-list">
        <li><div className="sf-inventory-list__primary"><div><strong>Physical unit</strong><span>{hold.unit.code} · {hold.unit.unitType.name} ({hold.unit.unitType.code})</span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>Location</strong><span>{hold.unit.location ? `${hold.unit.location.name} (${hold.unit.location.code})` : 'Location unavailable'}</span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>Protected dates</strong><span>{hold.startsOn.toISOString().slice(0, 10)} through {hold.endsOn.toISOString().slice(0, 10)} (end exclusive)</span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>Expiry</strong><span><time dateTime={hold.expiresAt.toISOString()}>{hold.expiresAt.toISOString()}</time></span></div></div></li>
      </ul>
      {canManageAvailability && pricingReview.effective ? <form action={`/api/inventory/rentals/holds/${hold.id}/release`} method="post"><button className="sf-button sf-button--secondary" type="submit">Release hold</button></form> : null}
    </section>

    <section className="sf-inventory-card" aria-labelledby="rental-hold-observed-pricing-title">
      <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Creation evidence</p><h2 id="rental-hold-observed-pricing-title">Observed pricing</h2></div><span>{pricingReview.original ? `${pricingReview.original.currency} ${moneyMinorToMajorString(pricingReview.original.totalMinor, pricingReview.original.currency)}` : 'Legacy evidence'}</span></div>
      {pricingReview.original ? <ul className="sf-inventory-list">
        <li><div className="sf-inventory-list__primary"><div><strong>Observed at</strong><span><time dateTime={pricingReview.original.observedAt.toISOString()}>{pricingReview.original.observedAt.toISOString()}</time></span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>Pricing fingerprint</strong><span><code>{pricingReview.original.fingerprint}</code></span></div></div></li>
      </ul> : <div className="sf-empty-state"><h3>No creation-time pricing evidence</h3><p>This legacy hold cannot prove what pricing configuration was observed when it was created.</p></div>}
      <p className="sf-field-hint">Observed pricing is immutable evidence for this hold. It does not lock price or authorize payment.</p>
    </section>

    <section className="sf-inventory-card" aria-labelledby="rental-hold-current-pricing-title">
      <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Fresh revalidation</p><h2 id="rental-hold-current-pricing-title">Current configured pricing</h2></div><span>{pricingReview.current.currency} {moneyMinorToMajorString(pricingReview.current.totalMinor, pricingReview.current.currency)}</span></div>
      <ul className="sf-inventory-list">{pricingReview.current.quote.segments.map((segment) => <li key={`${segment.startsOn}:${segment.endsOn}:${segment.dailyRateMinor}`}><div className="sf-inventory-list__primary"><div><strong>{pricingReview.current.currency} {segment.dailyRateMinor.toLocaleString()} minor units/day</strong><span>{segment.startsOn} through {segment.endsOn} · {segment.source}</span></div></div></li>)}</ul>
      <p className="sf-field-hint">Current fingerprint: <code>{pricingReview.current.fingerprint}</code>. Confirmation revalidates price, inventory, tenant ownership, and authority again inside the write transaction.</p>
    </section>

    <section className="sf-inventory-card" aria-labelledby="rental-booking-conversion-title">
      <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Staff booking desk</p><h2 id="rental-booking-conversion-title">Convert hold to booking</h2></div><span>{pricingReview.effective ? 'Server reviewed' : 'Hold inactive'}</span></div>
      {!canReviewConversion ? <div className="sf-empty-state"><h3>Booking conversion is restricted</h3><p>Your role needs booking management plus customer, inventory, availability, and pricing read access to review a rental booking conversion.</p></div> : !pricingReview.effective ? <div className="sf-empty-state"><h3>This hold cannot be converted</h3><p>Only an active, unexpired hold can enter rental booking confirmation.</p></div> : <>
        <form method="get" className="sf-form-row">
          <label className="sf-field">Find active customer<input name="customerSearch" maxLength={120} defaultValue={customerSearch} placeholder="Name or email" /></label>
          <button className="sf-button sf-button--secondary" type="submit">Search customers</button>
        </form>
        {customerResults && customerResults.customers.length === 0 ? <div className="sf-empty-state"><h3>No active customers found</h3><p>Create or refine the customer record before confirming a rental booking.</p><Link className="sf-button sf-button--secondary" href="/customers">Open customers</Link></div> : null}
        {customerResults && customerResults.customers.length > 0 ? <ul className="sf-inventory-list">{customerResults.customers.map((customer) => <li key={customer.id}><div className="sf-inventory-list__link"><Link className="sf-inventory-list__primary" href={customerSelectionHref(hold.id, customer.id, customerSearch)}><div><strong>{customer.firstName} {customer.lastName}</strong><span>{customer.email ?? customer.phone ?? 'No customer contact detail'}</span></div></Link></div></li>)}</ul> : null}
        {customerResults && customerResults.total > customerResults.customers.length ? <p className="sf-field-hint">Showing the first {customerResults.customers.length} of {customerResults.total} matching active customers. Refine the search to select a customer outside this bounded result.</p> : null}
        {conversionError ? <p className="sf-alert sf-alert--error" role="alert">{conversionError}</p> : null}
        {conversionReview ? <div className="sf-inventory-card">
          <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Conversion authority</p><h3>{conversionReview.customer.firstName} {conversionReview.customer.lastName}</h3></div><span>{conversionReview.ready ? 'Ready' : 'Blocked'}</span></div>
          <ul className="sf-inventory-list">
            <li><div className="sf-inventory-list__primary"><div><strong>Customer</strong><span>{conversionReview.customer.email ?? conversionReview.customer.phone ?? 'No contact detail'}</span></div></div></li>
            <li><div className="sf-inventory-list__primary"><div><strong>Physical unit</strong><span>{conversionReview.unit.name} ({conversionReview.unit.code}) · {conversionReview.unit.unitType.name} · {conversionReview.unit.location.name}</span></div></div></li>
            <li><div className="sf-inventory-list__primary"><div><strong>Current reviewed total</strong><span>{conversionReview.currentPricing.currency} {moneyMinorToMajorString(conversionReview.currentPricing.totalMinor, conversionReview.currentPricing.currency)}</span></div></div></li>
          </ul>
          {blockerMessage ? <p className="sf-alert sf-alert--error" role="alert">{blockerMessage}</p> : null}
          {conversionReview.ready && conversionReview.authorityFingerprint ? <>
            <p className="sf-field-hint">Authority fingerprint: <code>{conversionReview.authorityFingerprint}</code>. Confirmation will re-read and revalidate the exact tenant, hold, customer, inventory, price, and authority before any write.</p>
            {canConfirmConversion ? <form action={`/api/inventory/rentals/holds/${hold.id}/confirm`} method="post">
              <input type="hidden" name="customerId" value={conversionReview.customer.id} />
              <input type="hidden" name="authorityFingerprint" value={conversionReview.authorityFingerprint} />
              <button className="sf-button sf-button--primary" type="submit">Confirm rental booking</button>
            </form> : <p className="sf-alert" role="status">Your role can review the conversion but needs availability management permission to consume the hold and confirm the booking.</p>}
          </> : null}
        </div> : null}
      </>}
      <p className="sf-field-hint">Confirmation commits physical inventory under the reviewed price. It does not collect payment, authorize a deposit, or establish pickup, delivery, return, or fulfillment terms.</p>
    </section>
  </div>;
}
