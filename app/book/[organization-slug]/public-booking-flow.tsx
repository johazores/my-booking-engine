'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { readPublicBookingDocumentCapability, storePublicBookingDocumentCapability, usePublicBookingDocumentCapability } from './public-booking-document-capability.ts';

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
  currency: string;
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

type PaymentRecoveryStatus = {
  state?: unknown;
  canResumeCheckout?: unknown;
  canContinuePayment?: unknown;
};

const RECOVERY_PREFIX = 'sf-public-booking-recovery:';

function apiPath(organizationSlug: string, suffix: string) {
  return `/api/public-bookings/${encodeURIComponent(organizationSlug)}/hospitality/${suffix}`;
}

async function readJson(response: Response) {
  const parsed: unknown = await response.json().catch(() => null);
  const data = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
  if (!response.ok) {
    const message = typeof data?.message === 'string' && data.message.trim()
      ? data.message
      : 'This booking request could not be completed.';
    throw new Error(message);
  }
  // Successful public booking responses must be JSON objects, never synthetic status.
  if (!data) throw new Error('This booking response could not be verified. Please try again.');
  return data;
}

function isPaymentRecoveryStatus(value: unknown): value is {
  state: 'PAYMENT_REQUIRED' | 'PROCESSING' | 'PAID' | 'FAILED' | 'CANCELLED' | 'EXPIRED';
  canResumeCheckout: boolean;
  canContinuePayment: boolean;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const status = value as Record<string, unknown>;
  return typeof status.state === 'string'
    && ['PAYMENT_REQUIRED', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(status.state)
    && typeof status.canResumeCheckout === 'boolean'
    && typeof status.canContinuePayment === 'boolean';
}

function isCheckoutResponse(value: unknown): value is {
  state: 'CHECKOUT_REQUIRED' | 'PAID' | 'PROCESSING';
  checkoutUrl?: string | null;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return (result.state === 'CHECKOUT_REQUIRED' || result.state === 'PAID' || result.state === 'PROCESSING')
    && (result.state !== 'CHECKOUT_REQUIRED' || (typeof result.checkoutUrl === 'string' && result.checkoutUrl.length > 0));
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

function isReviewedQuote(value: unknown): value is Quote {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const quote = value as Record<string, unknown>;
  return typeof quote.currency === 'string'
    && /^[A-Z]{3}$/.test(quote.currency)
    && typeof quote.totalMinor === 'string'
    && /^(0|[1-9][0-9]{0,18})$/.test(quote.totalMinor)
    && typeof quote.pricingFingerprint === 'string'
    && quote.pricingFingerprint.length > 0
    && quote.pricingFingerprint.length <= 256
    && typeof quote.holdExpiresAt === 'string'
    && Number.isFinite(Date.parse(quote.holdExpiresAt));
}

function recoveryKey(organizationSlug: string) {
  return `${RECOVERY_PREFIX}${organizationSlug}`;
}

function storeRecovery(organizationSlug: string, recovery: BookingRecovery) {
  window.sessionStorage.setItem(recoveryKey(organizationSlug), JSON.stringify(recovery));
}

function clearRecovery(organizationSlug: string) {
  window.sessionStorage.removeItem(recoveryKey(organizationSlug));
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
    ) {
      clearRecovery(organizationSlug);
      return null;
    }
    return parsed as BookingRecovery;
  } catch {
    clearRecovery(organizationSlug);
    return null;
  }
}

export function PublicBookingRecovery({ organizationSlug }: { organizationSlug: string }) {
  const activeBookingCapability = usePublicBookingDocumentCapability(organizationSlug);
  return (
    <PublicBookingRecoveryPanel
      key={activeBookingCapability ?? 'none'}
      organizationSlug={organizationSlug}
      activeBookingCapability={activeBookingCapability}
    />
  );
}

function PublicBookingRecoveryPanel({
  organizationSlug,
  activeBookingCapability,
}: {
  organizationSlug: string;
  activeBookingCapability: string | null;
}) {
  const [recovery, setRecovery] = useState<BookingRecovery | null>(null);
  const [state, setState] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [canContinuePayment, setCanContinuePayment] = useState(false);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(false);
  const statusGeneration = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      statusGeneration.current += 1;
    };
  }, []);

  const isActive = useCallback((capability: string) =>
    mounted.current && readPublicBookingDocumentCapability(organizationSlug) === capability,
  [organizationSlug]);

  const checkStatus = useCallback(async (current: BookingRecovery, context: { cancelledReturn?: boolean } = {}) => {
    if (!isActive(current.bookingCapability)) return;
    const generation = ++statusGeneration.current;
    const isCurrent = () => generation === statusGeneration.current && isActive(current.bookingCapability);
    setBusy(true);
    try {
      const response = await fetch(apiPath(organizationSlug, 'payments/stripe-checkout/status'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bookingCapability: current.bookingCapability }),
      });
      const result = await readJson(response) as PaymentRecoveryStatus;
      if (!isCurrent()) return;
      if (!isPaymentRecoveryStatus(result)) throw new Error('Payment status response could not be verified.');
      const nextState = result.state;
      const canResumeCheckout = result.canResumeCheckout;
      const canContinue = result.canContinuePayment;
      setState(nextState);
      setCanContinuePayment(canContinue);
      if (nextState === 'PAID') {
        setMessage('Payment confirmed. Your reservation is confirmed.');
        clearRecovery(organizationSlug);
        setRecovery(null);
      } else if (nextState === 'PROCESSING') {
        if (context.cancelledReturn && canResumeCheckout) {
          setMessage('Payment was not completed. Your secure Checkout session is still available, so you can continue without creating another reservation.');
        } else if (context.cancelledReturn && canContinue) {
          setMessage('Payment was not completed. Your reservation is still recoverable and secure payment can be retried safely.');
        } else if (canResumeCheckout) {
          setMessage('Your secure Checkout session is still available. You can continue payment or check the latest status.');
        } else if (canContinue) {
          setMessage('Secure payment can be retried safely while this reservation remains recoverable.');
        } else {
          setMessage('Your payment is still being verified. You can check again safely.');
        }
      } else if (nextState === 'PAYMENT_REQUIRED' || nextState === 'FAILED') {
        setMessage(context.cancelledReturn
          ? 'Payment was not completed. Your reservation is still recoverable.'
          : 'Payment is still required for this reservation.');
      } else if (nextState === 'EXPIRED') {
        setMessage('This reservation attempt expired before payment was secured. Please search availability again.');
        setCanContinuePayment(false);
        clearRecovery(organizationSlug);
        setRecovery(null);
      } else if (nextState === 'CANCELLED') {
        setMessage('This reservation is cancelled.');
        setCanContinuePayment(false);
        clearRecovery(organizationSlug);
        setRecovery(null);
      } else {
        setMessage('We could not confirm the latest payment state.');
        setCanContinuePayment(false);
      }
    } catch (error) {
      if (!isCurrent()) return;
      setCanContinuePayment(false);
      setMessage(error instanceof Error ? error.message : 'Payment status could not be checked.');
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }, [isActive, organizationSlug]);

  async function resumePayment() {
    if (!recovery || !isActive(recovery.bookingCapability)) return;
    const capability = recovery.bookingCapability;
    setBusy(true);
    setMessage(null);

    const activeRecovery = state === 'FAILED'
      ? { ...recovery, checkoutRequestKey: crypto.randomUUID() }
      : recovery;
    if (activeRecovery !== recovery) {
      setRecovery(activeRecovery);
      storeRecovery(organizationSlug, activeRecovery);
    }

    try {
      const response = await fetch(apiPath(organizationSlug, 'payments/stripe-checkout'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bookingCapability: activeRecovery.bookingCapability,
          requestKey: activeRecovery.checkoutRequestKey,
        }),
      });
      const result = await readJson(response) as { state?: unknown; checkoutUrl?: unknown };
      if (!isActive(capability)) return;
      if (!isCheckoutResponse(result)) throw new Error('Payment response could not be verified.');
      if (result.state === 'CHECKOUT_REQUIRED' && typeof result.checkoutUrl === 'string') {
        const target = new URL(result.checkoutUrl);
        if (target.protocol !== 'https:') throw new Error('Secure payment redirect was invalid.');
        window.location.assign(target.toString());
        return;
      }
      if (result.state === 'PAID') {
        setState('PAID');
        setCanContinuePayment(false);
        setMessage('Payment confirmed. Your reservation is confirmed.');
        clearRecovery(organizationSlug);
        setRecovery(null);
        return;
      }
      await checkStatus(activeRecovery);
    } catch {
      if (isActive(capability)) await checkStatus(activeRecovery);
    }
  }

  useEffect(() => {
    const current = readRecovery(organizationSlug);
    if (!current || (activeBookingCapability && activeBookingCapability !== current.bookingCapability)) return;
    storePublicBookingDocumentCapability(organizationSlug, current.bookingCapability);
    setRecovery(current);
    const cancelledReturn = new URLSearchParams(window.location.search).get('payment') === 'cancelled';
    void checkStatus(current, { cancelledReturn });
  }, [activeBookingCapability, checkStatus, organizationSlug]);

  if (!recovery && !message) return null;

  const canResume = Boolean(recovery && canContinuePayment);
  const resumeLabel = state === 'FAILED' ? 'Start a new secure payment' : 'Continue secure payment';
  return (
    <section className="sf-public-booking__search-card" aria-live="polite" aria-labelledby="payment-status-title">
      <div>
        <p className="sf-public-booking__eyebrow">Reservation status</p>
        <h2 id="payment-status-title">{state === 'PAID' ? 'Reservation confirmed' : 'Payment recovery'}</h2>
        <p>{message || 'Checking the latest payment state…'}</p>
      </div>
      <div className="sf-public-booking__price">
        {canResume ? <button type="button" className="sf-public-booking__contact" onClick={resumePayment} disabled={busy}>{resumeLabel}</button> : null}
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
  const activeBookingCapability = usePublicBookingDocumentCapability(organizationSlug);
  const [paymentBookingCapability, setPaymentBookingCapability] = useState<string | null>(null);
  const [stage, setStage] = useState<'idle' | 'holding' | 'details' | 'confirming' | 'releasing' | 'payment' | 'error'>('idle');
  const [holdCapability, setHoldCapability] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [paymentState, setPaymentState] = useState<string | null>(null);
  const [releaseFailed, setReleaseFailed] = useState(false);
  const holdOperation = useRef<'reserving' | 'confirming' | 'releasing' | null>(null);
  const holdRequestKey = useRef<string | null>(null);
  const confirmationRequestKey = useRef<string | null>(null);
  const checkoutRequestKey = useRef<string | null>(null);

  function clearHoldClientState() {
    setHoldCapability(null);
    setQuote(null);
    holdRequestKey.current = null;
    confirmationRequestKey.current = null;
  }

  async function requestHoldRelease(capability: string) {
    try {
      const response = await fetch(apiPath(organizationSlug, 'holds'), {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ capability }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async function reserve() {
    if (holdOperation.current) return;
    holdOperation.current = 'reserving';
    setReleaseFailed(false);
    setStage('holding');
    setMessage(null);
    holdRequestKey.current ??= crypto.randomUUID();
    let createdCapability: string | null = null;
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
      createdCapability = holdResult.capability;
      setHoldCapability(createdCapability);

      const quoteResponse = await fetch(apiPath(organizationSlug, 'quote'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ capability: createdCapability, addonSelections: [] }),
      });
      const quoteResult = await readJson(quoteResponse) as { quote?: unknown };
      if (!isReviewedQuote(quoteResult.quote)) throw new Error('Current pricing could not be reviewed.');
      setQuote(quoteResult.quote);
      setStage('details');
    } catch (error) {
      const baseMessage = error instanceof Error ? error.message : 'This stay could not be held.';
      if (createdCapability) {
        const released = await requestHoldRelease(createdCapability);
        if (released) {
          clearHoldClientState();
          setMessage(`${baseMessage} The temporary hold was released.`);
        } else {
          setReleaseFailed(true);
          setMessage(`${baseMessage} The temporary hold could not be released right now; you can retry releasing it below.`);
        }
      } else {
        setMessage(baseMessage);
      }
      setStage('error');
    } finally {
      holdOperation.current = null;
    }
  }

  async function releaseHold() {
    if (holdOperation.current) return;
    holdOperation.current = 'releasing';
    setStage('releasing');
    setReleaseFailed(false);
    setMessage(null);
    try {
      const capability = holdCapability;
      if (!capability) {
        clearHoldClientState();
        setStage('idle');
        return;
      }

      const released = await requestHoldRelease(capability);
      if (!released) {
        setReleaseFailed(true);
        setStage('error');
        setMessage('The temporary hold could not be released right now. You can retry; otherwise it will expire automatically.');
        return;
      }

      clearHoldClientState();
      setStage('idle');
    } finally {
      holdOperation.current = null;
    }
  }

  async function startCheckout(bookingCapability: string, currency: string, totalMinor: string) {
    checkoutRequestKey.current ??= crypto.randomUUID();
    const recovery: BookingRecovery = {
      bookingCapability,
      checkoutRequestKey: checkoutRequestKey.current,
      currency,
      totalMinor,
    };
    setPaymentBookingCapability(bookingCapability);
    storeRecovery(organizationSlug, recovery);
    storePublicBookingDocumentCapability(organizationSlug, bookingCapability);
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
    // An older offer's Checkout response must not redirect away from the active booking.
    if (readPublicBookingDocumentCapability(organizationSlug) !== bookingCapability) return;
    if (!isCheckoutResponse(result)) throw new Error('Payment response could not be verified.');
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
    setPaymentState(result.state);
    setMessage('Your reservation was created and payment is being verified.');
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (holdOperation.current || !holdCapability || !quote) return;
    holdOperation.current = 'confirming';
    setStage('confirming');
    setMessage(null);

    const form = new FormData(event.currentTarget);
    const firstName = String(form.get('firstName') || '');
    const lastName = String(form.get('lastName') || '');
    const email = String(form.get('email') || '');
    const phone = String(form.get('phone') || '');

    // Preserve the active booking when a competing confirmation finishes first.
    const capabilityAtConfirmationStart = readPublicBookingDocumentCapability(organizationSlug);
    confirmationRequestKey.current ??= crypto.randomUUID();
    let bookingCreated = false;
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

      bookingCreated = true;
      clearHoldClientState();
      if (readPublicBookingDocumentCapability(organizationSlug) !== capabilityAtConfirmationStart) {
        // The booking exists, but a different booking became active while this request was pending.
        // Do not replace its recovery credentials or launch an older Checkout session.
        setPaymentBookingCapability(result.bookingCapability);
        setStage('payment');
        return;
      }
      await startCheckout(result.bookingCapability, result.booking.currency, result.booking.totalMinor);
    } catch (error) {
      if (bookingCreated) {
        setStage('payment');
        setPaymentState('RECOVERY_REQUIRED');
        setMessage('Your reservation is saved, but secure payment could not be opened. Recover payment to continue safely.');
        return;
      }
      setStage('error');
      setMessage(error instanceof Error ? error.message : 'The reservation could not be confirmed.');
    } finally {
      holdOperation.current = null;
    }
  }

  const paymentIsCurrent = paymentBookingCapability !== null && activeBookingCapability === paymentBookingCapability;

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
      {stage === 'releasing' ? <p className="sf-public-booking__notice" role="status">Releasing the temporary hold…</p> : null}

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
          <p className="sf-public-booking__contact-note">The named customer is also recorded as the primary guest. Payment recovery stays in this browser tab until the reservation is paid, cancelled, or expires.</p>
          <div className="sf-public-booking__price">
            <button type="submit" className="sf-public-booking__contact">Confirm and continue to payment</button>
            <button type="button" className="sf-public-booking__contact" onClick={releaseHold}>Release hold</button>
          </div>
        </form>
      ) : null}

      {stage === 'confirming' ? <p className="sf-public-booking__notice" role="status">Confirming the reservation and current price…</p> : null}
      {stage === 'payment' && !paymentIsCurrent ? (
        <p className="sf-public-booking__notice" role="status">Another reservation is now active. Check its payment status above.</p>
      ) : null}
      {stage === 'payment' && paymentIsCurrent ? (
        <div className="sf-public-booking__notice" role="status">
          <strong>{paymentState === 'PAID' ? 'Reservation confirmed' : 'Preparing secure payment…'}</strong>
          {message ? <span>{message}</span> : null}
          {paymentState && paymentState !== 'PAID' ? (
            <button type="button" className="sf-public-booking__contact" onClick={() => window.location.reload()}>
              {paymentState === 'RECOVERY_REQUIRED' ? 'Recover payment' : 'Check payment status'}
            </button>
          ) : null}
        </div>
      ) : null}
      {stage === 'error' ? (
        <div className="sf-public-booking__alert" role="alert">
          <p>{message || 'The reservation could not be completed.'}</p>
          {!holdCapability ? <button type="button" className="sf-public-booking__contact" onClick={reserve}>Try this stay again</button> : null}
          {holdCapability && releaseFailed ? <button type="button" className="sf-public-booking__contact" onClick={releaseHold}>Retry releasing hold</button> : null}
          {holdCapability && quote && !releaseFailed ? <button type="button" className="sf-public-booking__contact" onClick={() => setStage('details')}>Review details</button> : null}
          {holdCapability && !quote && !releaseFailed ? <button type="button" className="sf-public-booking__contact" onClick={releaseHold}>Release temporary hold</button> : null}
        </div>
      ) : null}
    </article>
  );
}
