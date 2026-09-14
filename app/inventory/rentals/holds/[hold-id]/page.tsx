import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { organizationRoleHasPermission } from '@/server/authorization/authorization-domain.ts';
import { readOrganizationAuthorization } from '@/server/authorization/authorization-service.ts';
import { readRentalAvailabilityHoldPricingReview } from '@/server/inventory/rental-hold-service.ts';
import { RentalInventoryUnavailableError } from '@/server/inventory/rental-service.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

function pricingStateMessage(state: 'CURRENT' | 'CHANGED' | 'LEGACY') {
  if (state === 'CURRENT') {
    return 'Current configured pricing still matches the quote observed when this hold was created.';
  }
  if (state === 'CHANGED') {
    return 'Configured pricing changed after this hold was created. Any future booking must use freshly revalidated pricing; the hold never locked the earlier amount.';
  }
  return 'This hold predates durable pricing evidence. Do not treat it as historical or current booking price authority.';
}

export default async function RentalAvailabilityHoldDetailPage({
  params,
}: {
  params: Promise<{ 'hold-id': string }>;
}) {
  const authState = await readAuthSessionState();
  const authRedirect = getAuthRequiredRedirect(authState);
  if (authRedirect) redirect(authRedirect);
  const session = authState.session;
  if (!session) throw new Error('Authenticated rental hold detail guard returned without a session');

  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) redirect('/inventory?error=tenant');
  const routeParams = await params;

  const authorization = await readOrganizationAuthorization({
    organizationId: activeContext.organization.id,
    userId: session.user.id,
  });
  const canReadAvailability = Boolean(
    authorization.platformAdmin
      || (authorization.role && organizationRoleHasPermission(authorization.role, 'availability:read')),
  );
  const canReadPricing = Boolean(
    authorization.platformAdmin
      || (authorization.role && organizationRoleHasPermission(authorization.role, 'pricing:read')),
  );
  const canManageAvailability = Boolean(
    authorization.platformAdmin
      || (authorization.role && organizationRoleHasPermission(authorization.role, 'availability:manage')),
  );
  if (!canReadAvailability || !canReadPricing) {
    return <section className="sf-inventory-empty"><p className="sf-eyebrow">Rental availability</p><h1>Hold review is restricted</h1><p>Your organization role needs both availability and pricing read access to review rental hold pricing evidence.</p></section>;
  }

  let review: Awaited<ReturnType<typeof readRentalAvailabilityHoldPricingReview>>;
  try {
    review = await readRentalAvailabilityHoldPricingReview({
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

  const hold = review.hold;
  return <div className="sf-inventory-page">
    <header className="sf-inventory-page__header">
      <div><p className="sf-eyebrow">Rental availability</p><h1>{hold.unit.name}</h1><p>Review inventory protection and current-vs-observed pricing evidence without turning the hold into a booking promise.</p></div>
      <div className="sf-image-scope__nav"><Link className="sf-button sf-button--secondary" href="/inventory/rentals/holds">Active holds</Link><Link className="sf-button sf-button--secondary" href="/inventory/rentals/availability">Availability preview</Link></div>
    </header>

    <p className={`sf-alert ${review.pricingState === 'CURRENT' ? 'sf-alert--success' : 'sf-alert--error'}`} role="status">{pricingStateMessage(review.pricingState)}</p>

    <section className="sf-inventory-card" aria-labelledby="rental-hold-detail-title">
      <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Inventory protection</p><h2 id="rental-hold-detail-title">Hold details</h2></div><span>{review.effective ? 'Effective' : hold.status}</span></div>
      <ul className="sf-inventory-list">
        <li><div className="sf-inventory-list__primary"><div><strong>Physical unit</strong><span>{hold.unit.code} · {hold.unit.unitType.name} ({hold.unit.unitType.code})</span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>Location</strong><span>{hold.unit.location ? `${hold.unit.location.name} (${hold.unit.location.code})` : 'Location unavailable'}</span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>Protected dates</strong><span>{hold.startsOn.toISOString().slice(0, 10)} through {hold.endsOn.toISOString().slice(0, 10)} (end exclusive)</span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>Expiry</strong><span><time dateTime={hold.expiresAt.toISOString()}>{hold.expiresAt.toISOString()}</time></span></div></div></li>
      </ul>
      {canManageAvailability && review.effective ? <form action={`/api/inventory/rentals/holds/${hold.id}/release`} method="post"><button className="sf-button sf-button--secondary" type="submit">Release hold</button></form> : null}
    </section>

    <section className="sf-inventory-card" aria-labelledby="rental-hold-observed-pricing-title">
      <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Creation evidence</p><h2 id="rental-hold-observed-pricing-title">Observed pricing</h2></div><span>{review.original ? `${review.original.currency} ${review.original.totalMinor.toString()} minor units` : 'Legacy evidence'}</span></div>
      {review.original ? <ul className="sf-inventory-list">
        <li><div className="sf-inventory-list__primary"><div><strong>Observed at</strong><span><time dateTime={review.original.observedAt.toISOString()}>{review.original.observedAt.toISOString()}</time></span></div></div></li>
        <li><div className="sf-inventory-list__primary"><div><strong>Pricing fingerprint</strong><span><code>{review.original.fingerprint}</code></span></div></div></li>
      </ul> : <div className="sf-empty-state"><h3>No creation-time pricing evidence</h3><p>This legacy hold cannot prove what pricing configuration was observed when it was created.</p></div>}
      <p className="sf-field-hint">Observed pricing is immutable evidence for this hold. It does not lock price, authorize payment, or establish a customer reservation.</p>
    </section>

    <section className="sf-inventory-card" aria-labelledby="rental-hold-current-pricing-title">
      <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Fresh revalidation</p><h2 id="rental-hold-current-pricing-title">Current configured pricing</h2></div><span>{review.current.currency} {review.current.totalMinor.toString()} minor units</span></div>
      <ul className="sf-inventory-list">{review.current.quote.segments.map((segment) => <li key={`${segment.startsOn}:${segment.endsOn}:${segment.dailyRateMinor}`}><div className="sf-inventory-list__primary"><div><strong>{review.current.currency} {segment.dailyRateMinor.toLocaleString()} minor units/day</strong><span>{segment.startsOn} through {segment.endsOn} · {segment.source}</span></div></div></li>)}</ul>
      <p className="sf-field-hint">Current fingerprint: <code>{review.current.fingerprint}</code>. A later rental booking workflow must revalidate price and commercial terms again while consuming inventory protection atomically.</p>
    </section>
  </div>;
}
