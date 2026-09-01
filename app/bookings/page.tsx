import Link from 'next/link';
import { redirect } from 'next/navigation';

import { HospitalityBookingWorkspace } from '@/components/hospitality-booking-workspace';
import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { organizationRoleHasPermission } from '@/server/authorization/authorization-domain.ts';
import { readOrganizationAuthorization } from '@/server/authorization/authorization-service.ts';
import { listHospitalityBookings } from '@/server/bookings/hospitality-booking-service.ts';
import { searchHospitalityOffers } from '@/server/bookings/hospitality-search-service.ts';
import { listCustomers } from '@/server/customers/customer-service.ts';
import { listHospitalityProperties } from '@/server/inventory/hospitality-service.ts';
import { listHospitalityAddons } from '@/server/pricing/hospitality-addon-service.ts';
import { listHospitalityPricingScopes } from '@/server/pricing/hospitality-pricing-scope-service.ts';
import { moneyMinorToMajorString } from '@/server/pricing/money.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

type BookingQuery = {
  property?: string;
  arrival?: string;
  departure?: string;
  quantity?: string;
  roomType?: string;
  ratePlan?: string;
};

export default async function BookingsPage({ searchParams }: { searchParams: Promise<BookingQuery> }) {
  const authState = await readAuthSessionState();
  const authRedirect = getAuthRequiredRedirect(authState);
  if (authRedirect) redirect(authRedirect);
  const session = authState.session;
  if (!session) throw new Error('Authenticated booking guard returned without a session');

  const query = await searchParams;
  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) redirect('/dashboard?error=tenant');
  const organization = activeContext.organization;
  const authorization = await readOrganizationAuthorization({ organizationId: organization.id, userId: session.user.id });
  const canRead = Boolean(authorization?.platformAdmin || (authorization?.role && organizationRoleHasPermission(authorization.role, 'booking:read')));
  const canManage = Boolean(authorization?.platformAdmin || (authorization?.role && organizationRoleHasPermission(authorization.role, 'booking:manage')));
  if (!canRead) return <section className="sf-inventory-empty"><p className="sf-eyebrow">Bookings</p><h1>Booking access is restricted</h1><p>Your organization role does not include booking access.</p></section>;

  const [properties, recentBookings] = await Promise.all([
    listHospitalityProperties({ organizationId: organization.id, actorUserId: session.user.id, page: 1, pageSize: 100 }),
    listHospitalityBookings({ organizationId: organization.id, actorUserId: session.user.id, page: 1, pageSize: 10 }),
  ]);
  const activeProperties = properties.properties.filter((property) => property.status === 'ACTIVE');

  let searchResults: Awaited<ReturnType<typeof searchHospitalityOffers>> | null = null;
  let searchError: string | null = null;
  if (query.arrival || query.departure || query.quantity) {
    try {
      searchResults = await searchHospitalityOffers({
        organizationId: organization.id,
        actorUserId: session.user.id,
        search: {
          arrivalDate: query.arrival ?? '',
          departureDate: query.departure ?? '',
          quantity: query.quantity ?? '1',
          propertyId: query.property || null,
        },
      });
    } catch (error) {
      searchError = error instanceof Error ? error.message : 'Offers could not be searched.';
    }
  }

  const selectedProperty = activeProperties.find((property) => property.id === query.property) ?? activeProperties[0] ?? null;
  const [scopes, customers, addons] = selectedProperty
    ? await Promise.all([
        listHospitalityPricingScopes({ organizationId: organization.id, actorUserId: session.user.id, propertyId: selectedProperty.id, page: 1, pageSize: 100 }),
        listCustomers({ organizationId: organization.id, actorUserId: session.user.id, search: '', status: 'ACTIVE', sort: 'name-asc', page: 1, pageSize: 100 }),
        listHospitalityAddons({ organizationId: organization.id, actorUserId: session.user.id, propertyId: selectedProperty.id, page: 1, pageSize: 100 }),
      ])
    : [null, null, null];

  const initialQuantity = query.quantity && /^\d+$/.test(query.quantity) ? Number(query.quantity) : 1;
  const initialSelection = query.roomType && query.ratePlan && query.arrival && query.departure && Number.isSafeInteger(initialQuantity) && initialQuantity >= 1 && initialQuantity <= 50
    ? { roomTypeId: query.roomType, ratePlanId: query.ratePlan, arrivalDate: query.arrival, departureDate: query.departure, quantity: initialQuantity }
    : null;

  const workspaceAddons = (addons?.addons ?? []).filter((addon) => addon.status === 'ACTIVE').map((addon) => ({
    id: addon.id,
    roomTypeId: addon.roomTypeId,
    ratePlanId: addon.ratePlanId,
    name: addon.name,
    code: addon.code,
    pricingModel: addon.pricingModel,
    amountMinor: addon.amountMinor.toString(),
    currency: addon.currency,
    maxQuantity: addon.maxQuantity,
    startDate: addon.startDate.toISOString().slice(0, 10),
    endDate: addon.endDate.toISOString().slice(0, 10),
  }));

  return <div className="sf-inventory-page">
    <header className="sf-inventory-page__header"><div><p className="sf-eyebrow">Commercial operations</p><h1>Bookings</h1><p>Search real sellable offers, then continue through availability, hold, pricing, customer selection, and atomic confirmation.</p></div><span className="sf-inventory-count">{recentBookings.total} bookings</span></header>

    <section className="sf-booking-card" aria-labelledby="offer-search-title">
      <div className="sf-booking-card__heading"><div><p className="sf-eyebrow">Search</p><h2 id="offer-search-title">Available hospitality offers</h2></div><span>{searchResults ? `${searchResults.offers.length} result${searchResults.offers.length === 1 ? '' : 's'}` : 'Up to 25 results'}</span></div>
      <form method="get" className="sf-booking-grid">
        <label className="sf-field">Property<select name="property" defaultValue={query.property ?? ''}><option value="">All active properties</option>{activeProperties.map((property) => <option key={property.id} value={property.id}>{property.name} · {property.code}</option>)}</select></label>
        <label className="sf-field">Arrival<input name="arrival" type="date" defaultValue={query.arrival ?? ''} required /></label>
        <label className="sf-field">Departure<input name="departure" type="date" defaultValue={query.departure ?? ''} required /></label>
        <label className="sf-field">Rooms<input name="quantity" type="number" min="1" max="50" defaultValue={query.quantity ?? '1'} required /></label>
        <button className="sf-button sf-button--primary" type="submit">Search offers</button>
      </form>
      {searchError ? <p className="sf-alert" role="alert">{searchError}</p> : null}
      {searchResults?.scopeLimitReached ? <p className="sf-alert" role="status">This organization has {searchResults.totalScopes} active room/rate scopes. Search evaluated the first {searchResults.scopeLimit}; choose a property to narrow the search and avoid a partial result set.</p> : null}
      {searchResults?.resultLimitReached ? <p className="sf-alert" role="status">More than {searchResults.resultLimit} sellable offers matched. Showing the lowest-priced {searchResults.resultLimit}; narrow the property if you need a smaller result set.</p> : null}
      {searchResults && searchResults.offers.length === 0 ? <div className="sf-empty-state"><h3>No sellable offers</h3><p>No active room and rate-plan combination has both capacity and complete pricing for this stay.</p></div> : null}
      {searchResults && searchResults.offers.length > 0 ? <div className="sf-room-table-wrap"><table className="sf-room-table"><thead><tr><th scope="col">Property</th><th scope="col">Room / rate</th><th scope="col">Availability</th><th scope="col">Total</th><th scope="col">Action</th></tr></thead><tbody>{searchResults.offers.map((offer) => {
        const href = `/bookings?property=${encodeURIComponent(offer.property.id)}&arrival=${encodeURIComponent(offer.stay.arrivalDate)}&departure=${encodeURIComponent(offer.stay.departureDate)}&quantity=${offer.stay.quantity}&roomType=${encodeURIComponent(offer.roomType.id)}&ratePlan=${encodeURIComponent(offer.ratePlan.id)}`;
        return <tr key={`${offer.property.id}:${offer.roomType.id}:${offer.ratePlan.id}`}><th scope="row"><span>{offer.property.name}</span><small>{[offer.property.city, offer.property.region, offer.property.countryCode].filter(Boolean).join(', ')}</small></th><td>{offer.roomType.name}<br /><small>{offer.ratePlan.name}{offer.ratePlan.description ? ` · ${offer.ratePlan.description}` : ''}</small></td><td>{offer.capacity.sellableUnits} sellable<br /><small>{offer.capacity.remainingUnits} remaining after request</small></td><td>{offer.price.currency} {moneyMinorToMajorString(BigInt(offer.price.totalMinor), offer.price.currency)}</td><td><Link className="sf-button sf-button--secondary" href={href}>Select offer</Link></td></tr>;
      })}</tbody></table></div> : null}
    </section>

    <section className="sf-booking-card" aria-labelledby="booking-property-title"><div className="sf-booking-card__heading"><div><p className="sf-eyebrow">Booking desk</p><h2 id="booking-property-title">Selected property</h2></div><span>{activeProperties.length} active properties</span></div>
      {activeProperties.length === 0 ? <div className="sf-empty-state"><h3>No active hospitality property</h3><p>Create active hospitality inventory before opening the booking desk.</p><Link className="sf-button sf-button--primary" href="/inventory">Open inventory</Link></div> : <form className="sf-booking-property-form" method="get"><label className="sf-field">Property<select name="property" defaultValue={selectedProperty?.id}>{activeProperties.map((property) => <option key={property.id} value={property.id}>{property.name} · {property.code}</option>)}</select></label><button className="sf-button sf-button--secondary" type="submit">Load property</button></form>}
    </section>

    {selectedProperty && scopes && customers ? <HospitalityBookingWorkspace
      propertyId={selectedProperty.id}
      propertyName={selectedProperty.name}
      scopes={scopes.scopes.map((scope) => ({ roomTypeId: scope.roomTypeId, ratePlanId: scope.ratePlanId, roomType: scope.roomType, ratePlan: scope.ratePlan }))}
      customers={customers.customers.map((customer) => ({ id: customer.id, firstName: customer.firstName, lastName: customer.lastName, email: customer.email }))}
      addons={workspaceAddons}
      canManage={canManage}
      initialSelection={initialSelection}
    /> : null}

    <section className="sf-booking-card" aria-labelledby="recent-bookings-title"><div className="sf-booking-card__heading"><div><p className="sf-eyebrow">History</p><h2 id="recent-bookings-title">Recent bookings</h2></div><span>{recentBookings.total} total</span></div>
      {recentBookings.bookings.length === 0 ? <div className="sf-empty-state"><h3>No bookings yet</h3><p>Confirmed bookings will appear here with their immutable price snapshot.</p></div> : <div className="sf-room-table-wrap"><table className="sf-room-table"><thead><tr><th scope="col">Customer</th><th scope="col">Stay</th><th scope="col">Offer</th><th scope="col">Total</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead><tbody>{recentBookings.bookings.map((booking) => <tr key={booking.id}><th scope="row"><span>{booking.customer.firstName} {booking.customer.lastName}</span><small>{booking.customer.email ?? booking.id}</small></th><td>{booking.arrivalDate.toISOString().slice(0, 10)} → {booking.departureDate.toISOString().slice(0, 10)}<br /><small>{booking.quantity} room{booking.quantity === 1 ? '' : 's'}</small></td><td>{booking.roomType.name}<br /><small>{booking.ratePlan.name}</small></td><td>{booking.currency} {moneyMinorToMajorString(booking.totalMinor, booking.currency)}</td><td><span className="sf-status-badge">{booking.status.toLowerCase()}</span><br /><small>payment {booking.paymentStatus.toLowerCase()}</small></td><td><Link className="sf-button sf-button--secondary" href={`/bookings/${booking.id}`}>View booking</Link></td></tr>)}</tbody></table></div>}
    </section>
  </div>;
}
