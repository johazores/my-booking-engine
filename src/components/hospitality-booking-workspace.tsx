'use client';

import { useMemo, useState } from 'react';

type Scope = {
  roomTypeId: string;
  ratePlanId: string;
  roomType: { name: string; code: string };
  ratePlan: { name: string; code: string };
};

type Customer = { id: string; firstName: string; lastName: string; email: string | null };
type Addon = {
  id: string;
  roomTypeId: string | null;
  ratePlanId: string | null;
  name: string;
  code: string;
  pricingModel: string;
  amountMinor: string;
  currency: string;
  maxQuantity: number;
  startDate: string;
  endDate: string;
};

type Availability = {
  available: boolean;
  unavailableReasons: string[];
  stay: { nights: number; quantity: number };
  capacity: { sellableUnits: number; remainingUnits: number };
};

type Hold = { id: string; expiresAt: string };
type Quote = {
  currency: string;
  accommodationSubtotalMinor: string;
  taxTotalMinor: string;
  feeTotalMinor: string;
  addonTotalMinor: string;
  totalMinor: string;
  fingerprint: string;
};
type Booking = { id: string; status: string; paymentStatus: string; currency: string; totalMinor: string };

type InitialSelection = { roomTypeId: string; ratePlanId: string; arrivalDate: string; departureDate: string; quantity: number };
type Props = {
  propertyId: string;
  propertyName: string;
  scopes: Scope[];
  customers: Customer[];
  addons: Addon[];
  canManage: boolean;
  initialSelection?: InitialSelection | null;
};

function requestKey() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `sf-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatMinor(amountMinor: string, currency: string) {
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  const scale = 10n ** BigInt(digits);
  const amount = BigInt(amountMinor);
  if (digits === 0) return `${currency} ${amount.toString()}`;
  const whole = amount / scale;
  const fraction = (amount % scale).toString().padStart(digits, '0');
  return `${currency} ${whole.toString()}.${fraction}`;
}

function previousDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

async function postJson(path: string, body: unknown) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message ?? 'The booking operation could not be completed.') as Error & { code?: string };
    error.code = payload.error;
    throw error;
  }
  return payload;
}

export function HospitalityBookingWorkspace({ propertyId, propertyName, scopes, customers, addons, canManage, initialSelection }: Props) {
  const initialScopeKey = initialSelection && scopes.some((item) => item.roomTypeId === initialSelection.roomTypeId && item.ratePlanId === initialSelection.ratePlanId)
    ? `${initialSelection.roomTypeId}:${initialSelection.ratePlanId}`
    : scopes[0] ? `${scopes[0].roomTypeId}:${scopes[0].ratePlanId}` : '';
  const [scopeKey, setScopeKey] = useState(initialScopeKey);
  const [arrivalDate, setArrivalDate] = useState(initialSelection?.arrivalDate ?? '');
  const [departureDate, setDepartureDate] = useState(initialSelection?.departureDate ?? '');
  const [quantity, setQuantity] = useState(initialSelection?.quantity ?? 1);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [hold, setHold] = useState<Hold | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? '');
  const [addonQuantities, setAddonQuantities] = useState<Record<string, number>>({});
  const [booking, setBooking] = useState<Booking | null>(null);
  const [holdIdempotencyKey, setHoldIdempotencyKey] = useState<string | null>(null);
  const [bookingIdempotencyKey, setBookingIdempotencyKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(initialSelection ? 'Offer loaded from search. Check availability again before holding inventory.' : null);

  const scope = useMemo(() => scopes.find((item) => `${item.roomTypeId}:${item.ratePlanId}` === scopeKey) ?? null, [scopeKey, scopes]);
  const applicableAddons = useMemo(() => {
    const lastOccupiedDate = arrivalDate && departureDate && departureDate > arrivalDate ? previousDate(departureDate) : null;
    return addons.filter((addon) => {
      const scopeMatches = !addon.roomTypeId || (addon.roomTypeId === scope?.roomTypeId && addon.ratePlanId === scope?.ratePlanId);
      const datesMatch = !lastOccupiedDate || (addon.startDate <= arrivalDate && addon.endDate >= lastOccupiedDate);
      return scopeMatches && datesMatch;
    });
  }, [addons, scope, arrivalDate, departureDate]);
  const selections = useMemo(() => Object.entries(addonQuantities).filter(([, selectedQuantity]) => selectedQuantity > 0).map(([addonId, selectedQuantity]) => ({ addonId, quantity: selectedQuantity })), [addonQuantities]);

  function resetCommercialState() {
    setAvailability(null);
    setHold(null);
    setQuote(null);
    setBooking(null);
    setHoldIdempotencyKey(null);
    setBookingIdempotencyKey(null);
    setMessage(null);
  }

  function bookingRequest() {
    if (!scope) throw new Error('Choose a room type and rate plan.');
    return { propertyId, roomTypeId: scope.roomTypeId, ratePlanId: scope.ratePlanId, arrivalDate, departureDate, quantity };
  }

  async function checkAvailability() {
    setBusy(true);
    setMessage(null);
    setHold(null);
    setQuote(null);
    setBooking(null);
    setHoldIdempotencyKey(null);
    setBookingIdempotencyKey(null);
    try {
      const result = await postJson('/api/bookings/hospitality/availability', bookingRequest()) as Availability;
      setAvailability(result);
      if (!result.available) setMessage(`Not available: ${result.unavailableReasons.join(', ')}.`);
    } catch (error) {
      setAvailability(null);
      setMessage(error instanceof Error ? error.message : 'Availability could not be checked.');
    } finally {
      setBusy(false);
    }
  }

  async function reserveAndQuote() {
    setBusy(true);
    setMessage(null);
    const stableHoldKey = holdIdempotencyKey ?? `hold:${requestKey()}`;
    if (!holdIdempotencyKey) setHoldIdempotencyKey(stableHoldKey);
    try {
      const request = bookingRequest();
      const createdHold = await postJson('/api/bookings/hospitality/holds', { idempotencyKey: stableHoldKey, request }) as Hold;
      const currentQuote = await postJson('/api/bookings/hospitality/quote', { request, addonSelections: selections }) as Quote;
      setHold(createdHold);
      setQuote(currentQuote);
      setMessage('Inventory is temporarily held. Review the current price before confirming.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The temporary hold could not be created. Retry will use the same request key.');
    } finally {
      setBusy(false);
    }
  }

  async function refreshQuote() {
    if (!hold) return;
    setBusy(true);
    try {
      const currentQuote = await postJson('/api/bookings/hospitality/quote', { request: bookingRequest(), addonSelections: selections }) as Quote;
      setQuote(currentQuote);
      setMessage('Price refreshed. Review the updated total before confirming.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Pricing could not be refreshed.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmBooking() {
    if (!hold || !quote || !customerId) return;
    setBusy(true);
    setMessage(null);
    const stableBookingKey = bookingIdempotencyKey ?? `booking:${requestKey()}`;
    if (!bookingIdempotencyKey) setBookingIdempotencyKey(stableBookingKey);
    try {
      const confirmed = await postJson('/api/bookings/hospitality/confirm', {
        holdId: hold.id,
        customerId,
        idempotencyKey: stableBookingKey,
        expectedPricingFingerprint: quote.fingerprint,
        addonSelections: selections,
      }) as Booking;
      setBooking(confirmed);
      setMessage('Booking confirmed. Inventory is permanently allocated.');
    } catch (error) {
      const bookingError = error as Error & { code?: string };
      if (bookingError.code === 'price-changed') {
        await refreshQuote();
        setMessage('The price changed before confirmation. The latest price is shown below; review it and confirm again.');
      } else if (bookingError.code === 'unavailable') {
        setHold(null);
        setQuote(null);
        setAvailability(null);
        setHoldIdempotencyKey(null);
        setBookingIdempotencyKey(null);
        setMessage('The hold is no longer available. Check availability again to continue.');
      } else {
        setMessage(bookingError.message);
      }
    } finally {
      setBusy(false);
    }
  }

  if (scopes.length === 0) {
    return <div className="sf-empty-state"><h2>No sellable room-rate scopes</h2><p>Configure an active room type, assigned rate plan, availability, and pricing before creating bookings.</p></div>;
  }

  return <div className="sf-booking-workspace">
    <section className="sf-booking-card" aria-labelledby="booking-search-title">
      <div className="sf-booking-card__heading"><div><p className="sf-eyebrow">1 · Offer</p><h2 id="booking-search-title">Stay and offer</h2></div><span>{propertyName}</span></div>
      <div className="sf-booking-grid">
        <label className="sf-field">Room type + rate plan<select value={scopeKey} onChange={(event) => { setScopeKey(event.target.value); setAddonQuantities({}); resetCommercialState(); }}>{scopes.map((item) => <option key={`${item.roomTypeId}:${item.ratePlanId}`} value={`${item.roomTypeId}:${item.ratePlanId}`}>{item.roomType.name} · {item.ratePlan.name}</option>)}</select></label>
        <label className="sf-field">Arrival<input type="date" value={arrivalDate} onChange={(event) => { setArrivalDate(event.target.value); setAddonQuantities({}); resetCommercialState(); }} required /></label>
        <label className="sf-field">Departure<input type="date" value={departureDate} onChange={(event) => { setDepartureDate(event.target.value); setAddonQuantities({}); resetCommercialState(); }} required /></label>
        <label className="sf-field">Rooms<input type="number" min="1" max="50" value={quantity} onChange={(event) => { setQuantity(Number(event.target.value)); resetCommercialState(); }} /></label>
      </div>
      <button className="sf-button sf-button--primary" type="button" disabled={busy || !arrivalDate || !departureDate} onClick={checkAvailability}>{busy ? 'Checking…' : 'Check availability'}</button>
      {availability ? <div className={`sf-booking-status${availability.available ? ' sf-booking-status--success' : ' sf-booking-status--error'}`} role="status"><strong>{availability.available ? 'Available' : 'Unavailable'}</strong><span>{availability.stay.nights} nights · {availability.capacity.sellableUnits} sellable units · {availability.capacity.remainingUnits} remaining after this request</span></div> : null}
    </section>

    {availability?.available ? <section className="sf-booking-card" aria-labelledby="booking-options-title">
      <div className="sf-booking-card__heading"><div><p className="sf-eyebrow">2 · Options</p><h2 id="booking-options-title">Add-ons</h2></div><span>{applicableAddons.length} available configurations</span></div>
      {applicableAddons.length === 0 ? <p className="sf-muted">No add-ons are configured for this room-rate scope and stay.</p> : <div className="sf-booking-addon-list">{applicableAddons.map((addon) => <label className="sf-booking-addon" key={addon.id}><span><strong>{addon.name}</strong><small>{addon.code} · {addon.pricingModel.toLowerCase().replaceAll('_', ' ')} · {formatMinor(addon.amountMinor, addon.currency)}</small></span><input aria-label={`${addon.name} quantity`} type="number" min="0" max={addon.maxQuantity} disabled={Boolean(hold) || busy} value={addonQuantities[addon.id] ?? 0} onChange={(event) => { setAddonQuantities((current) => ({ ...current, [addon.id]: Number(event.target.value) })); setQuote(null); setBooking(null); setBookingIdempotencyKey(null); }} /></label>)}</div>}
      {!hold ? <button className="sf-button sf-button--primary" type="button" disabled={busy || !canManage} onClick={reserveAndQuote}>{busy ? 'Reserving…' : 'Hold inventory and price'}</button> : null}
      {!canManage ? <p className="sf-muted">Your role can review booking data but cannot create bookings.</p> : null}
    </section> : null}

    {hold && quote ? <section className="sf-booking-card" aria-labelledby="booking-review-title">
      <div className="sf-booking-card__heading"><div><p className="sf-eyebrow">3 · Review</p><h2 id="booking-review-title">Current price</h2></div><span>Hold expires {new Date(hold.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div>
      <dl className="sf-booking-totals"><div><dt>Accommodation</dt><dd>{formatMinor(quote.accommodationSubtotalMinor, quote.currency)}</dd></div><div><dt>Taxes</dt><dd>{formatMinor(quote.taxTotalMinor, quote.currency)}</dd></div><div><dt>Fees</dt><dd>{formatMinor(quote.feeTotalMinor, quote.currency)}</dd></div><div><dt>Add-ons</dt><dd>{formatMinor(quote.addonTotalMinor, quote.currency)}</dd></div><div className="sf-booking-totals__total"><dt>Total</dt><dd>{formatMinor(quote.totalMinor, quote.currency)}</dd></div></dl>
      <button className="sf-button sf-button--secondary" type="button" disabled={busy} onClick={refreshQuote}>Refresh price</button>
    </section> : null}

    {hold && quote ? <section className="sf-booking-card" aria-labelledby="booking-customer-title">
      <div className="sf-booking-card__heading"><div><p className="sf-eyebrow">4 · Customer</p><h2 id="booking-customer-title">Book for</h2></div><span>{customers.length} active customers loaded</span></div>
      {customers.length === 0 ? <div className="sf-empty-state"><h3>No active customers</h3><p>Create a customer record before confirming this booking.</p><a className="sf-button sf-button--secondary" href="/customers">Open customers</a></div> : <><label className="sf-field">Customer<select value={customerId} onChange={(event) => { setCustomerId(event.target.value); setBookingIdempotencyKey(null); }}>{customers.map((customer) => <option value={customer.id} key={customer.id}>{customer.firstName} {customer.lastName}{customer.email ? ` · ${customer.email}` : ''}</option>)}</select></label><button className="sf-button sf-button--primary" type="button" disabled={busy || !customerId || Boolean(booking)} onClick={confirmBooking}>{busy ? 'Confirming…' : booking ? 'Confirmed' : 'Confirm booking'}</button></>}
    </section> : null}

    {message ? <p className={`sf-alert${booking ? ' sf-alert--success' : ''}`} role="status">{message}</p> : null}
    {booking ? <section className="sf-booking-confirmation" aria-labelledby="booking-confirmed-title"><p className="sf-eyebrow">Confirmed</p><h2 id="booking-confirmed-title">Booking {booking.id}</h2><p>{booking.status.toLowerCase()} · payment {booking.paymentStatus.toLowerCase()} · {formatMinor(booking.totalMinor, booking.currency)}</p><a className="sf-button sf-button--secondary" href="/bookings">Start another booking</a></section> : null}
  </div>;
}
