import Link from 'next/link';
import { redirect } from 'next/navigation';

import { HospitalityBookingWorkspace } from '@/components/hospitality-booking-workspace';
import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { organizationRoleHasPermission } from '@/server/authorization/authorization-domain.ts';
import { readOrganizationAuthorization } from '@/server/authorization/authorization-service.ts';
import { listHospitalityBookings } from '@/server/bookings/hospitality-booking-service.ts';
import { listCustomers } from '@/server/customers/customer-service.ts';
import { listHospitalityProperties } from '@/server/inventory/hospitality-service.ts';
import { listHospitalityAddons } from '@/server/pricing/hospitality-addon-service.ts';
import { listHospitalityPricingScopes } from '@/server/pricing/hospitality-pricing-scope-service.ts';
import { moneyMinorToMajorString } from '@/server/pricing/money.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

export default async function BookingsPage({ searchParams }: { searchParams: Promise<{ property?: string }> }) {
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
  const selectedProperty = activeProperties.find((property) => property.id === query.property) ?? activeProperties[0] ?? null;

  const [scopes, customers, addons] = selectedProperty
    ? await Promise.all([
        listHospitalityPricingScopes({ organizationId: organization.id, actorUserId: session.user.id, propertyId: selectedProperty.id, page: 1, pageSize: 100 }),
        listCustomers({ organizationId: organization.id, actorUserId: session.user.id, search: '', status: 'ACTIVE', sort: 'name-asc', page: 1, pageSize: 100 }),
        listHospitalityAddons({ organizationId: organization.id, actorUserId: session.user.id, propertyId: selectedProperty.id, page: 1, pageSize: 100 }),
      ])
    : [null, null, null];

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
    <header className="sf-inventory-page__header"><div><p className="sf-eyebrow">Commercial operations</p><h1>Bookings</h1><p>Create real hospitality bookings through the same availability, hold, pricing, and atomic confirmation services used by the application API.</p></div><span className="sf-inventory-count">{recentBookings.total} bookings</span></header>

    <section className="sf-booking-card" aria-labelledby="booking-property-title"><div className="sf-booking-card__heading"><div><p className="sf-eyebrow">Property</p><h2 id="booking-property-title">Booking desk</h2></div><span>{activeProperties.length} active properties</span></div>
      {activeProperties.length === 0 ? <div className="sf-empty-state"><h3>No active hospitality property</h3><p>Create active hospitality inventory before opening the booking desk.</p><Link className="sf-button sf-button--primary" href="/inventory">Open inventory</Link></div> : <form className="sf-booking-property-form" method="get"><label className="sf-field">Property<select name="property" defaultValue={selectedProperty?.id}>{activeProperties.map((property) => <option key={property.id} value={property.id}>{property.name} · {property.code}</option>)}</select></label><button className="sf-button sf-button--secondary" type="submit">Load property</button></form>}
    </section>

    {selectedProperty && scopes && customers ? <HospitalityBookingWorkspace
      propertyId={selectedProperty.id}
      propertyName={selectedProperty.name}
      scopes={scopes.scopes.map((scope) => ({ roomTypeId: scope.roomTypeId, ratePlanId: scope.ratePlanId, roomType: scope.roomType, ratePlan: scope.ratePlan }))}
      customers={customers.customers.map((customer) => ({ id: customer.id, firstName: customer.firstName, lastName: customer.lastName, email: customer.email }))}
      addons={workspaceAddons}
      canManage={canManage}
    /> : null}

    <section className="sf-booking-card" aria-labelledby="recent-bookings-title"><div className="sf-booking-card__heading"><div><p className="sf-eyebrow">History</p><h2 id="recent-bookings-title">Recent bookings</h2></div><span>{recentBookings.total} total</span></div>
      {recentBookings.bookings.length === 0 ? <div className="sf-empty-state"><h3>No bookings yet</h3><p>Confirmed bookings will appear here with their immutable price snapshot.</p></div> : <div className="sf-room-table-wrap"><table className="sf-room-table"><thead><tr><th scope="col">Customer</th><th scope="col">Stay</th><th scope="col">Offer</th><th scope="col">Total</th><th scope="col">Status</th></tr></thead><tbody>{recentBookings.bookings.map((booking) => <tr key={booking.id}><th scope="row"><span>{booking.customer.firstName} {booking.customer.lastName}</span><small>{booking.customer.email ?? booking.id}</small></th><td>{booking.arrivalDate.toISOString().slice(0, 10)} → {booking.departureDate.toISOString().slice(0, 10)}<br /><small>{booking.quantity} room{booking.quantity === 1 ? '' : 's'}</small></td><td>{booking.roomType.name}<br /><small>{booking.ratePlan.name}</small></td><td>{booking.currency} {moneyMinorToMajorString(booking.totalMinor, booking.currency)}</td><td><span className="sf-status-badge">{booking.status.toLowerCase()}</span><br /><small>payment {booking.paymentStatus.toLowerCase()}</small></td></tr>)}</tbody></table></div>}
    </section>
  </div>;
}
