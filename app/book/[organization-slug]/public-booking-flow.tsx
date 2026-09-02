'use client';

import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

type PublicOffer = {
  propertyId: string;
  roomTypeId: string;
  ratePlanId: string;
  propertyName: string;
  roomTypeName: string;
  ratePlanName: string;
  ratePlanDescription: string | null;
  location: string;
  sellableUnits: number;
  nights: number;
  quantity: number;
  maxOccupancy: number;
  arrivalDate: string;
  departureDate: string;
  currency: string;
  totalMinor: string;
  formattedTotal: string;
  formattedTax: string;
  formattedFees: string;
};

type Quote = {
  arrivalDate: string;
  departureDate: string;
  stayNights: number;
  quantity: number;
  currency: string;
  accommodationSubtotalMinor: string;
  taxTotalMinor: string;
  feeTotalMinor: string;
  addonTotalMinor: string;
  totalMinor: string;
  pricingFingerprint: string;
  holdExpiresAt: string;
};

type BookingRecovery = {
  bookingCapability: string;
  checkoutRequestKey: string;
  currency: string;
  totalMinor: string;
};

type ApiError = {
  error?: string;
  message?: string;
};

const RECOVERY_PREFIX = 'sf-public-booking-recovery:';

function apiPath(organizationSlug: string, suffix: string) {
  return `/api/public-bookings/${encodeURIComponent(organizationSlug)}/hospitality/${suffix}`;
}

async function readJson(response: Response) {
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const error = data as ApiError;
    throw new Error(error.message || 'This booking request could not be completed.');
  }
  return data;
}

function formatMinor(amountMinor: string, currency: string) {
  const fractionDigits = new Intl.NumberFormat(undefined, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  const scale = 10n ** BigInt(fractionDigits);
  const minor = BigInt(amountMinor);
  const whole = minor / scale;
  const fraction = minor % scale;
  return fractionDigits === 0
    ? `${currency} ${whole.toString()}`
    : `${currency} ${whole.toString()}.${fraction.toString().padStart(fractionDigits, '0')}`;
}

function recoveryKey(organizationSlug: string) {
  return `${RECOVERY_PREFIX}${organizationSlug}`;
}

function storeRecovery(organizationSlug: string, recovery: BookingRecovery) {
  window.sessionStorage.setItem(recoveryKey(organizationSlug), JSON.stringify(recovery));
}

function readRecovery(organizationSlug: string): BookingRecovery | null {
  const raw = window.sessionStorage.getItem(recoveryKey(organizationSlug));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<BookingRecovery>;
    if (
      typeof parsed.bookingCapability !== 'string'
      || typeof parsed.checkoutRequestKey !== 'string'
      || typeof parsed.currency !== 'string'
      || typeof parsed.totalMinor !== 'string'
    ) return null;
    return parsed as BookingRecovery;
  } catch {
    return null;
  }
}

function clearRecovery(organizationSlug: string) {
  window.sessionStorage.removeItem(recoveryKey(organizationSlug));
}

export function PublicBookingRecovery({ organizationSlug }: { organizationSlug: string }) {
  const [recovery, setRecovery] = useState<BookingRecovery | null>(null);
  const [state, setState] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function checkStatus(current: BookingRecovery) {
    setBusy(true);
    try {
      const response = await fetch(apiPath(organizationSlug, 'payments/stripe-checkout/status'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bookingCapability: current.bookingCapability }),
      });
      const result = await readJson(response) as { state?: unknown };
      const nextState = typeof result.state === 'string' ? result.state : 'PROCESSING';
      setState(nextState);
      if (nextState === 'PAID') {
        setMessage('Payment confirmed. Your reservation is confirmed.');
        clearRecovery(organizationSlug);
      } else if (nextState === 'PROCESSING') {
        setMessage('Your payment is still being verified. You can check again safely.');
      } else if (nextState === 'PAYMENT_REQUIRED' || nextState === 'FAILED') {
        setMessage('Payment is still required for this reservation.');
      } else if (nextState === 'EXPIRED') {
        setMessage('This reservation attempt expired before payment was secured. Please search availability again.');
        clearRecovery(organizationSlug);
      } else if (nextState === 'CANCELLED') {
        setMessage('This reservation is cancelled.');
        clearRecovery(organizationSlug);
      } else {
        setMessage('We could not confirm the latest payment state.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Payment status could not be checked.');
    } finally {
      setBusy(false);
    }
  }

  async function resumePayment() {
    if (!recovery) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(apiPath(organizationSlug, 'payments/stripe-checkout'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bookingCapability: recovery.bookingCapability,
          requestKey: recovery.checkoutRequestKey,
        }),
      });
      const result = await readJson(response) as { state?: unknown; checkoutUrl?: unknown };
      if (result.state === 'CHECKOUT_REQUIRED' && typeof result.checkoutUrl === 'string') {
        const target = new URL(result.checkoutUrl);
        if (target.protocol !== 'https:') throw new Error('Secure payment redirect was invalid.');
        window.location.assign(target.toString());
        return;
      }
      if (result.state === 'PAID') {
        setState('PAID');
        setMessage('Payment confirmed. Your reservation is confirmed.');
        clearRecovery(organizationSlug);
        return;
      }
      await checkStatus(recovery);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Secure payment could not be resumed.');
      setBusy(false);
    }
  }

  useEffect(() => {
    const current = readRecovery(organizationSlug);
    if (!current) return;
    setRecovery(current);
    const paymentReturn = new URLSearchParams(window.location.search).get('payment');
    if (paymentReturn === 'cancelled') {
      setMessage('Payment was not completed. Your reservation may still be recoverable.');
    }
    void checkStatus(current);
  }, [organizationSlug]);

  if (!recovery && !message) return null;

  const canResume = recovery && (state === 'PAYMENT_REQUIRED' || state === 'FAILED');
  return (
    <section className="sf-public-booking__search-card" aria-live="polite" aria-labelledby="payment-status-title">
      <div>
        <p className="sf-public-booking__eyebrow">Reservation status</p>
        <h2 id="payment-status-title">{state === 'PAID' ? 'Reservation confirmed' : 'Payment recovery'}</h2>
        <p>{message || 'Checking the latest payment state…'}</p>
      </div>
      <div className="sf-public-booking__price">
        {canResume ? <button type="button" className="sf-public-booking__contact" onClick={resumePayment} disabled={busy}>Continue secure payment</button> : null}
        {recovery && state !== 'PAID' && state !== 'EXPIRED' && state !== 'CANCELLED'
          ? <button type="button" className="sf-public-booking__contact" onClick={() => checkStatus(recovery)} disabled={busy}>Check status</button>
          : null}
      </div>
    </section>
  );
}

export function PublicBookingOfferCard({
  organizationSlug,
  offer,
}: {
  organizationSlug: string;
  offer: PublicOffer;
}) {
  const [stage, setStage] = useState<'idle' | 'holding' | 'details' | 'confirming' | 'payment' | 'error'>('idle');
  const [holdCapability, setHoldCapability] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [paymentState, setPaymentState] = useState<string | null>(null);
  const holdRequestKey = useRef<string | null>(null);
  const confirmationRequestKey = useRef<string | null>(null);
  const checkoutRequestKey = useRef<string | null>(null);

  async function reserve() {
    setStage('holding');
    setMessage(null);
    holdRequestKey.current ??= crypto.randomUUID();
    try {
      const holdResponse = await fetch(apiPath(organizationSlug, 'holds'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requestKey: holdRequestKey.current,
          request: {
            propertyId: offer.propertyId,
            roomTypeId: offer.roomTypeId,
            ratePlanId: offer.ratePlanId,
            arrivalDate: offer.arrivalDate,
            departureDate: offer.departureDate,
            quantity: offer.quantity,
          },
        }),
      });
      const holdResult = await readJson(holdResponse) as { capability?: unknown };
      if (typeof holdResult.capability !== 'string') throw new Error('The reservation hold response was incomplete.');
      setHoldCapability(holdResult.capability);

      const quoteResponse = await fetch(apiPath(organizationSlug, 'quote'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ capability: holdResult.capability, addonSelections: [] }),
      });
      const quoteResult = await readJson(quoteResponse) as { quote?: unknown };
      if (!quoteResult.quote || typeof quoteResult.quote !== 'object') throw new Error('Current pricing could not be reviewed.');
      setQuote(quoteResult.quote as Quote);
      setStage('details');
    } catch (error) {
      setStage('error');
      setMessage(error instanceof Error ? error.message : 'This stay could not be held.');
    }
  }

  async function releaseHold() {
    const capability = holdCapability;
    setHoldCapability(null);
    setQuote(null);
    setStage('idle');
    setMessage(null);
    holdRequestKey.current = null;
    confirmationRequestKey.current = null;
    if (!capability) return;
    await fetch(apiPath(organizationSlug, 'holds'), {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ capability }),
    }).catch(() => undefined);
  }

  async function startCheckout(bookingCapability: string, currency: string, totalMinor: string) {
    checkoutRequestKey.current ??= crypto.randomUUID();
    const recovery: BookingRecovery = {
      bookingCapability,
      checkoutRequestKey: checkoutRequestKey.current,
      currency,
      totalMinor,
    };
    storeRecovery(organizationSlug, recovery);
    setStage('payment');

    const response = await fetch(apiPath(organizationSlug, 'payments/stripe-checkout'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bookingCapability,
        requestKey: checkoutRequestKey.current,
      }),
    });
    const result = await readJson(response) as { state?: unknown; checkoutUrl?: unknown };
    if (result.state === 'CHECKOUT_REQUIRED' && typeof result.checkoutUrl === 'string') {
      const target = new URL(result.checkoutUrl);
      if (target.protocol !== 'https:') throw new Error('Secure payment redirect was invalid.');
      window.location.assign(target.toString());
      return;
    }
    if (result.state === 'PAID') {
      clearRecovery(organizationSlug);
      setPaymentState('PAID');
      setMessage('Payment confirmed. Your reservation is confirmed.');
      return;
    }
    setPaymentState(typeof result.state === 'string' ? result.state : 'PROCESSING');
    setMessage('Your reservation was created and payment is being verified.');
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!holdCapability || !quote) return;
    setStage('confirming');
    setMessage(null);

    const form = new FormData(event.currentTarget);
    const firstName = String(form.get('firstName') || '');
    const lastName = String(form.get('lastName') || '');
    const email = String(form.get('email') || '');
    const phone = String(form.get('phone') || '');

    confirmationRequestKey.current ??= crypto.randomUUID();
    try {
      const response = await fetch(apiPath(organizationSlug, 'confirmation'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          capability: holdCapability,
          requestKey: confirmationRequestKey.current,
          expectedPricingFingerprint: quote.pricingFingerprint,
          customer: { firstName, lastName, email, phone },
          guests: [{ firstName, lastName, email }],
          addonSelections: [],
        }),
      });
      if (response.status === 400) confirmationRequestKey.current = null;
      const result = await readJson(response) as {
        booking?: { currency?: unknown; totalMinor?: unknown };
        bookingCapability?: unknown;
      };
      if (
        typeof result.bookingCapability !== 'string'
        || !result.booking
        || typeof result.booking.currency !== 'string'
        || typeof result.booking.totalMinor !== 'string'
      ) throw new Error('The reservation confirmation response was incomplete.');

      await startCheckout(result.bookingCapability, result.booking.currency, result.booking.totalMinor);
    } catch (error) {
      setStage('error');
      setMessage(error instanceof Error ? error.message : 'The reservation could not be confirmed.');
    }
  }

  return (
    <article className="sf-public-booking__offer">
      <div className="sf-public-booking__offer-main">
        <div>
          <p className="sf-public-booking__property">{offer.propertyName}</p>
          <h3>{offer.roomTypeName}</h3>
          <p className="sf-public-booking__location">{offer.location}</p>
        </div>
        <span className="sf-public-booking__availability">{offer.sellableUnits} available</span>
      </div>
      <div className="sf-public-booking__rate">
        <strong>{offer.ratePlanName}</strong>
        {offer.ratePlanDescription ? <p>{offer.ratePlanDescription}</p> : null}
      </div>
      <dl className="sf-public-booking__facts">
        <div><dt>Stay</dt><dd>{offer.nights} night{offer.nights === 1 ? '' : 's'}</dd></div>
        <div><dt>Rooms</dt><dd>{offer.quantity}</dd></div>
        <div><dt>Max occupancy</dt><dd>{offer.maxOccupancy} per room</dd></div>
      </dl>
      <div className="sf-public-booking__price">
        <div>
          <span>Total stay price</span>
          <strong>{offer.formattedTotal}</strong>
        </div>
        <small>Includes {offer.formattedTax} tax and {offer.formattedFees} fees.</small>
      </div>

      {stage === 'idle' ? (
        <button type="button" className="sf-public-booking__contact" onClick={reserve}>Reserve this stay</button>
      ) : null}
      {stage === 'holding' ? <p className="sf-public-booking__notice" role="status">Holding current inventory and rechecking price…</p> : null}

      {stage === 'details' && quote ? (
        <form className="sf-public-booking__rate" onSubmit={confirm}>
          <div className="sf-public-booking__section-heading">
            <div>
              <strong>Price reviewed: {formatMinor(quote.totalMinor, quote.currency)}</strong>
              <span>Held until {new Date(quote.holdExpiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <span>Payment follows on Stripe</span>
          </div>
          <div className="sf-public-booking__search-form">
            <label><span>First name</span><input name="firstName" autoComplete="given-name" maxLength={80} required /></label>
            <label><span>Last name</span><input name="lastName" autoComplete="family-name" maxLength={80} required /></label>
            <label><span>Email</span><input name="email" type="email" autoComplete="email" maxLength={320} required /></label>
            <label><span>Phone <small>(optional)</small></span><input name="phone" type="tel" autoComplete="tel" maxLength={40} /></label>
          </div>
          <p className="sf-public-booking__contact-note">The named customer is also recorded as the primary guest. Your email is used for reservation recovery.</p>
          <div className="sf-public-booking__price">
            <button type="submit" className="sf-public-booking__contact">Confirm and continue to payment</button>
            <button type="button" className="sf-public-booking__contact" onClick={releaseHold}>Release hold</button>
          </div>
        </form>
      ) : null}

      {stage === 'confirming' ? <p className="sf-public-booking__notice" role="status">Confirming the reservation and current price…</p> : null}
      {stage === 'payment' ? (
        <div className="sf-public-booking__notice" role="status">
          <strong>{paymentState === 'PAID' ? 'Reservation confirmed' : 'Preparing secure payment…'}</strong>
          {message ? <span>{message}</span> : null}
        </div>
      ) : null}
      {stage === 'error' ? (
        <div className="sf-public-booking__alert" role="alert">
          <p>{message || 'The reservation could not be completed.'}</p>
          {!holdCapability ? <button type="button" className="sf-public-booking__contact" onClick={reserve}>Try this stay again</button> : null}
          {holdCapability && quote ? <button type="button" className="sf-public-booking__contact" onClick={() => setStage('details')}>Review details</button> : null}
        </div>
      ) : null}
    </article>
  );
}
