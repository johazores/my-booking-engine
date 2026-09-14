import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { organizationRoleHasPermission } from '@/server/authorization/authorization-domain.ts';
import { readOrganizationAuthorization } from '@/server/authorization/authorization-service.ts';
import { RentalAvailabilityIntegrityError } from '@/server/inventory/rental-availability-domain.ts';
import { searchRentalInventoryAvailability } from '@/server/inventory/rental-availability-service.ts';
import { RentalInventoryValidationError } from '@/server/inventory/rental-domain.ts';
import { RentalInventoryUnavailableError } from '@/server/inventory/rental-service.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

type RentalAvailabilitySearchParams = {
  unitTypeCode?: string;
  locationCode?: string;
  startsOn?: string;
  endsOn?: string;
  page?: string;
  pageSize?: string;
};

function resultHref(search: Readonly<{
  unitTypeCode: string;
  locationCode: string | null;
  startsOn: Date;
  endsOn: Date;
  pageSize: number;
}>, page: number) {
  const params = new URLSearchParams({
    unitTypeCode: search.unitTypeCode,
    startsOn: search.startsOn.toISOString().slice(0, 10),
    endsOn: search.endsOn.toISOString().slice(0, 10),
    page: String(page),
    pageSize: String(search.pageSize),
  });
  if (search.locationCode) params.set('locationCode', search.locationCode);
  return `/inventory/rentals/availability?${params.toString()}`;
}

export default async function RentalAvailabilityPage({
  searchParams,
}: {
  searchParams: Promise<RentalAvailabilitySearchParams>;
}) {
  const authState = await readAuthSessionState();
  const authRedirect = getAuthRequiredRedirect(authState);
  if (authRedirect) redirect(authRedirect);
  const session = authState.session;
  if (!session) throw new Error('Authenticated rental availability guard returned without a session');

  const query = await searchParams;
  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) redirect('/inventory?error=tenant');

  const authorization = await readOrganizationAuthorization({
    organizationId: activeContext.organization.id,
    userId: session.user.id,
  });
  const canRead = Boolean(
    authorization.platformAdmin
      || (authorization.role && organizationRoleHasPermission(authorization.role, 'inventory:read')),
  );
  if (!canRead) {
    return <section className="sf-inventory-empty"><p className="sf-eyebrow">Rental availability</p><h1>Rental access is restricted</h1><p>Your organization role does not include inventory access.</p></section>;
  }

  const hasSearch = Boolean(query.unitTypeCode || query.locationCode || query.startsOn || query.endsOn);
  let result: Awaited<ReturnType<typeof searchRentalInventoryAvailability>> | null = null;
  let searchError: string | null = null;
  if (hasSearch) {
    try {
      result = await searchRentalInventoryAvailability({
        organizationId: activeContext.organization.id,
        actorUserId: session.user.id,
        search: {
          unitTypeCode: query.unitTypeCode ?? '',
          locationCode: query.locationCode,
          startsOn: query.startsOn ?? '',
          endsOn: query.endsOn ?? '',
          page: query.page,
          pageSize: query.pageSize,
        },
      });
    } catch (error) {
      if (error instanceof RentalInventoryValidationError) {
        searchError = error.message;
      } else if (error instanceof RentalInventoryUnavailableError) {
        searchError = 'The requested active rental unit type or location is not available in this organization.';
      } else if (error instanceof RentalAvailabilityIntegrityError) {
        searchError = 'Rental pricing data is inconsistent. Resolve the overlapping or invalid pricing periods before using this preview.';
      } else {
        throw error;
      }
    }
  }

  return <div className="sf-inventory-page">
    <header className="sf-inventory-page__header">
      <div><p className="sf-eyebrow">Rental inventory</p><h1>Availability and pricing preview</h1><p>Inspect active physical stock against explicit unavailable dates and the effective daily pricing calendar for {activeContext.organization.name}.</p></div>
      <Link className="sf-button sf-button--secondary" href="/inventory/rentals">Back to rentals</Link>
    </header>

    <section className="sf-inventory-card" aria-labelledby="rental-availability-search-title">
      <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Inventory preview</p><h2 id="rental-availability-search-title">Check a rental window</h2></div><span>Maximum 90 days</span></div>
      <form className="sf-form" method="get" action="/inventory/rentals/availability">
        <div className="sf-form-row"><label className="sf-field">Unit type code<input name="unitTypeCode" maxLength={32} required autoCapitalize="characters" defaultValue={query.unitTypeCode ?? ''} /></label><label className="sf-field">Location code (optional)<input name="locationCode" maxLength={32} autoCapitalize="characters" defaultValue={query.locationCode ?? ''} /></label></div>
        <div className="sf-form-row"><label className="sf-field">Start date<input name="startsOn" type="date" required defaultValue={query.startsOn ?? ''} /></label><label className="sf-field">End date (exclusive)<input name="endsOn" type="date" required defaultValue={query.endsOn ?? ''} /></label></div>
        <input type="hidden" name="pageSize" value={query.pageSize ?? '20'} />
        <button className="sf-button sf-button--primary" type="submit">Preview availability</button>
      </form>
      <p className="sf-field-hint">This is an internal inventory preview. It does not create a hold or booking and must not be used as customer booking confirmation until rental reservation persistence is implemented.</p>
    </section>

    {searchError ? <p className="sf-alert sf-alert--error" role="alert">{searchError}</p> : null}

    {result ? <>
      <section className="sf-inventory-card" aria-labelledby="rental-availability-results-title">
        <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Available stock</p><h2 id="rental-availability-results-title">{result.unitType.name}</h2></div><span>{result.availability.total} available</span></div>
        <p>{result.unitType.code} · {result.location ? `${result.location.name} (${result.location.code})` : 'All active rental locations'} · {result.search.startsOn.toISOString().slice(0, 10)} through {result.search.endsOn.toISOString().slice(0, 10)} (end exclusive)</p>
        {result.availability.items.length === 0 ? <div className="sf-empty-state"><h3>No unblocked units in this inventory window</h3><p>No active, location-assigned physical units in this scope are free of explicit availability blocks for the full requested period.</p></div> : <ul className="sf-inventory-list">{result.availability.items.map((unit) => <li key={unit.id}><div className="sf-inventory-list__link"><Link className="sf-inventory-list__primary" href={`/inventory/rentals/units/${unit.id}`}><div><strong>{unit.name}</strong><span>{unit.code} · {unit.location ? `${unit.location.name} (${unit.location.code})` : 'Location unavailable'}</span></div></Link></div></li>)}</ul>}
        {result.availability.totalPages > 1 ? <nav className="sf-pagination" aria-label="Rental availability result pages">{result.availability.page > 1 ? <Link className="sf-button sf-button--secondary sf-button--compact" href={resultHref(result.search, result.availability.page - 1)}>Previous</Link> : <span />}<span>Page {result.availability.page} of {result.availability.totalPages}</span>{result.availability.page < result.availability.totalPages ? <Link className="sf-button sf-button--secondary sf-button--compact" href={resultHref(result.search, result.availability.page + 1)}>Next</Link> : <span />}</nav> : null}
      </section>

      <section className="sf-inventory-card" aria-labelledby="rental-pricing-preview-title">
        <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Effective pricing</p><h2 id="rental-pricing-preview-title">Pricing calendar</h2></div><span>{result.unitType.currency} {result.pricing.totalMinor.toLocaleString()} minor units</span></div>
        <p>{result.pricing.days} rental days. Pricing uses the unit type default rate unless a configured date-range override applies.</p>
        <ul className="sf-inventory-list">{result.pricing.segments.map((segment) => <li key={`${segment.startsOn}:${segment.endsOn}:${segment.dailyRateMinor}`}><div className="sf-inventory-list__primary"><div><strong>{result.unitType.currency} {segment.dailyRateMinor.toLocaleString()} minor units/day</strong><span>{segment.startsOn} through {segment.endsOn} · {segment.source}</span></div></div></li>)}</ul>
      </section>
    </> : null}
  </div>;
}
