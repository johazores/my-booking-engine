import type { CSSProperties } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PublicBookingOfferCard, PublicBookingRecovery } from './public-booking-flow.tsx';
import { PublicBookingSettlementReceipt } from './public-booking-receipt.tsx';
import { readPublicHospitalityBookingPage, searchPublicHospitalityOffers } from '@/server/bookings/public-hospitality-search-service.ts';
import { moneyMinorToMajorString } from '@/server/pricing/money.ts';

import '../public-booking.css';

type BookingPageQuery = {
  arrival?: string | string[];
  departure?: string | string[];
  quantity?: string | string[];
  payment?: string | string[];
};

type BookingPageProps = {
  params: Promise<{ 'organization-slug': string }>;
  searchParams: Promise<BookingPageQuery>;
};

function scalar(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatMoney(amountMinor: string, currency: string) {
  return `${currency} ${moneyMinorToMajorString(BigInt(amountMinor), currency)}`;
}

function organizationStyle(branding: NonNullable<Awaited<ReturnType<typeof readPublicHospitalityBookingPage>>>) {
  return {
    '--sf-public-primary': branding.primaryColor,
    '--sf-public-secondary': branding.secondaryColor,
    '--sf-public-accent': branding.accentColor,
    '--sf-public-font': branding.fontStack,
  } as CSSProperties;
}

export async function generateMetadata({ params }: Pick<BookingPageProps, 'params'>): Promise<Metadata> {
  const resolvedParams = await params;
  const branding = await readPublicHospitalityBookingPage(resolvedParams['organization-slug']);
  if (!branding) return { title: 'Booking unavailable' };
  const title = branding.publicBookingTitle || `Book with ${branding.name}`;
  return {
    title,
    description: branding.publicBookingDescription || `Check live availability and pricing for ${branding.name}.`,
    icons: branding.faviconUrl ? { icon: branding.faviconUrl } : undefined,
  };
}

export default async function PublicBookingPage({ params, searchParams }: BookingPageProps) {
  const [resolvedParams, query] = await Promise.all([params, searchParams]);
  const organizationSlug = resolvedParams['organization-slug'];
  const branding = await readPublicHospitalityBookingPage(organizationSlug);
  if (!branding) notFound();

  const arrival = scalar(query.arrival) ?? '';
  const departure = scalar(query.departure) ?? '';
  const quantity = scalar(query.quantity) ?? '1';
  const searchRequested = Boolean(arrival || departure || scalar(query.quantity));
  let searchResults: Awaited<ReturnType<typeof searchPublicHospitalityOffers>> | null = null;
  let searchError: string | null = null;

  if (searchRequested) {
    if (!arrival || !departure) {
      searchError = 'Choose both an arrival and departure date to check availability.';
    } else {
      try {
        searchResults = await searchPublicHospitalityOffers({
          organizationSlug,
          search: { arrivalDate: arrival, departureDate: departure, quantity },
        });
      } catch {
        searchError = 'These stay details could not be searched. Check the dates and room quantity and try again.';
      }
    }
  }

  const title = branding.publicBookingTitle || `Stay with ${branding.name}`;
  const description = branding.publicBookingDescription || 'Check live room availability and current pricing for your stay.';
  const contactHref = branding.contactEmail
    ? `mailto:${branding.contactEmail}`
    : branding.contactPhone
      ? `tel:${branding.contactPhone.replace(/\s+/g, '')}`
      : branding.websiteUrl;

  return (
    <main className="sf-public-booking" style={organizationStyle(branding)}>
      <header className="sf-public-booking__header">
        <div className="sf-public-booking__container sf-public-booking__header-inner">
          <a className="sf-public-booking__brand" href={`/book/${encodeURIComponent(branding.slug)}`} aria-label={`${branding.name} booking home`}>
            {branding.logoUrl ? <img src={branding.logoUrl} alt="" className="sf-public-booking__logo" /> : null}
            <span>{branding.name}</span>
          </a>
          {branding.websiteUrl ? <a className="sf-public-booking__header-link" href={branding.websiteUrl}>Website</a> : null}
        </div>
      </header>

      <section className="sf-public-booking__hero">
        <div className="sf-public-booking__container sf-public-booking__hero-inner">
          <p className="sf-public-booking__eyebrow">Direct booking</p>
          <h1>{title}</h1>
          <p className="sf-public-booking__lead">{description}</p>
        </div>
      </section>

      <section className="sf-public-booking__container sf-public-booking__content" aria-labelledby="availability-title">
        <PublicBookingRecovery organizationSlug={organizationSlug} />
        <PublicBookingSettlementReceipt organizationSlug={organizationSlug} />

        <div className="sf-public-booking__search-card">
          <div className="sf-public-booking__section-heading">
            <div>
              <p className="sf-public-booking__eyebrow">Your stay</p>
              <h2 id="availability-title">Check live availability</h2>
            </div>
            <span>Current inventory and pricing</span>
          </div>
          <form method="get" className="sf-public-booking__search-form">
            <label>
              <span>Arrival</span>
              <input type="date" name="arrival" defaultValue={arrival} required />
            </label>
            <label>
              <span>Departure</span>
              <input type="date" name="departure" defaultValue={departure} required />
            </label>
            <label>
              <span>Rooms</span>
              <input type="number" name="quantity" min="1" max="50" defaultValue={quantity} required inputMode="numeric" />
            </label>
            <button type="submit">Check availability</button>
          </form>
          {searchError ? <p className="sf-public-booking__alert" role="alert">{searchError}</p> : null}
          {searchResults?.scopeLimitReached ? <p className="sf-public-booking__notice" role="status">This search covers the first {searchResults.scopeLimit} active room and rate combinations. Contact the property if you need more options.</p> : null}
          {searchResults?.resultLimitReached ? <p className="sf-public-booking__notice" role="status">Showing the {searchResults.resultLimit} lowest-priced live offers. Additional matching options may be available.</p> : null}
        </div>

        {searchResults && searchResults.offers.length === 0 ? (
          <div className="sf-public-booking__empty" role="status">
            <h2>No rooms available for these dates</h2>
            <p>Try different dates or a smaller room quantity.</p>
            {contactHref ? <a href={contactHref}>Contact {branding.name}</a> : null}
          </div>
        ) : null}

        {searchResults && searchResults.offers.length > 0 ? (
          <div className="sf-public-booking__results" aria-live="polite">
            <div className="sf-public-booking__results-heading">
              <div>
                <p className="sf-public-booking__eyebrow">Available now</p>
                <h2>{searchResults.offers.length} live offer{searchResults.offers.length === 1 ? '' : 's'}</h2>
              </div>
              <p>{arrival} → {departure}</p>
            </div>
            <div className="sf-public-booking__offer-grid">
              {searchResults.offers.map((offer) => (
                <PublicBookingOfferCard
                  key={`${offer.property.id}:${offer.roomType.id}:${offer.ratePlan.id}`}
                  organizationSlug={organizationSlug}
                  offer={{
                    propertyId: offer.property.id,
                    roomTypeId: offer.roomType.id,
                    ratePlanId: offer.ratePlan.id,
                    propertyName: offer.property.name,
                    roomTypeName: offer.roomType.name,
                    ratePlanName: offer.ratePlan.name,
                    ratePlanDescription: offer.ratePlan.description,
                    location: [offer.property.city, offer.property.region, offer.property.countryCode].filter(Boolean).join(', '),
                    sellableUnits: offer.capacity.sellableUnits,
                    nights: offer.stay.nights,
                    quantity: offer.stay.quantity,
                    maxOccupancy: offer.roomType.maxOccupancy,
                    arrivalDate: offer.stay.arrivalDate,
                    departureDate: offer.stay.departureDate,
                    currency: offer.price.currency,
                    totalMinor: offer.price.totalMinor,
                    formattedTotal: formatMoney(offer.price.totalMinor, offer.price.currency),
                    formattedTax: formatMoney(offer.price.taxTotalMinor, offer.price.currency),
                    formattedFees: formatMoney(offer.price.feeTotalMinor, offer.price.currency),
                  }}
                />
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <footer className="sf-public-booking__footer">
        <div className="sf-public-booking__container">
          <p>Availability and pricing are rechecked before confirmation. Payment is completed securely with the configured payment provider.</p>
          {branding.contactEmail ? <a href={`mailto:${branding.contactEmail}`}>{branding.contactEmail}</a> : null}
          {branding.contactPhone ? <a href={`tel:${branding.contactPhone.replace(/\s+/g, '')}`}>{branding.contactPhone}</a> : null}
        </div>
      </footer>
    </main>
  );
}
