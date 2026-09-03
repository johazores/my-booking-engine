'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

type RecoveryStatus = Readonly<{
  bookingId: string;
  amendmentId: string;
  state: 'CHECKOUT_REQUIRED' | 'CHECKOUT_RESUME_REQUIRED' | 'CHECKOUT_PENDING' | 'READY_TO_CLOSE' | 'RECOVERED' | 'WAIT_FOR_PROVIDER' | 'RECOVERY_REQUIRED' | 'NOT_EXPIRED' | 'TERMINAL' | 'CONFLICT';
  reason: string;
  providerCode: string | null;
  operation: string | null;
  amountDisplay: string | null;
  terminalStatus: string | null;
}>;

type CheckoutResponse = RecoveryStatus & Readonly<{
  checkoutUrl?: string | null;
  checkoutExpiresAt?: string | null;
}>;

function errorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return fallback;
  const record = payload as Record<string, unknown>;
  if (typeof record.message === 'string' && record.message.trim()) return record.message;
  if (typeof record.error === 'string' && record.error.trim()) return record.error;
  return fallback;
}

export function BookingCommercialAmendmentRecoveryAction(props: {
  bookingId: string;
  initialStatus: RecoveryStatus;
}) {
  const router = useRouter();
  const [returnState, setReturnState] = useState<'returned' | 'cancelled' | null>(null);
  const [status, setStatus] = useState(props.initialStatus);
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const autoChecked = useRef(false);
  const endpoint = `/api/bookings/hospitality/${props.bookingId}/commercial-amendments/${status.amendmentId}/recovery/stripe-checkout`;

  async function checkStatus() {
    if (checking || starting) return;
    setChecking(true);
    setError('');
    try {
      const response = await fetch(`${endpoint}/status`, { method: 'POST', headers: { Accept: 'application/json' } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(payload, 'Stripe recovery status could not be verified.'));
      const next = payload as RecoveryStatus;
      setStatus(next);
      if (next.state === 'RECOVERED') {
        setNotice('Commercial amendment recovery is complete. The original booking settlement has been restored.');
        router.refresh();
      } else if (next.state === 'CHECKOUT_REQUIRED' || next.state === 'CHECKOUT_RESUME_REQUIRED') {
        setNotice('Provider truth is clear. A customer-authorized Stripe payment is required to restore the original booking settlement.');
      } else if (next.state === 'CHECKOUT_PENDING' || next.state === 'WAIT_FOR_PROVIDER') {
        setNotice('Stripe has not reached a final payment state yet. No booking money or commercial state will be changed until provider truth is final.');
      } else {
        setNotice('Recovery state refreshed from authoritative server and provider evidence.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Stripe recovery status could not be verified.');
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('commercialAmendmentId') !== props.initialStatus.amendmentId) return;
    const marker = params.get('commercialRecovery');
    if (marker !== 'returned' && marker !== 'cancelled') return;
    setReturnState(marker);
    setNotice(marker === 'returned'
      ? 'Returned from Stripe. Verifying provider settlement before recovery can close…'
      : 'Stripe Checkout was cancelled. SF is verifying provider truth before another payment attempt is allowed…');
  }, [props.initialStatus.amendmentId]);

  useEffect(() => {
    if (!returnState || autoChecked.current) return;
    autoChecked.current = true;
    void checkStatus();
    // checkStatus deliberately runs once for the trusted Stripe return/cancel marker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnState]);

  async function startCheckout() {
    if (starting || checking) return;
    setStarting(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { Accept: 'application/json' } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(payload, 'Secure Stripe recovery Checkout could not be started.'));
      const next = payload as CheckoutResponse;
      setStatus(next);
      if (typeof next.checkoutUrl === 'string' && next.checkoutUrl.length > 0) {
        window.location.assign(next.checkoutUrl);
        return;
      }
      if (next.state === 'RECOVERED') {
        setNotice('Commercial amendment recovery is already complete.');
        router.refresh();
        return;
      }
      setNotice('Recovery state changed before Checkout was required. Review the current provider state below.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Secure Stripe recovery Checkout could not be started.');
    } finally {
      setStarting(false);
    }
  }

  const checkoutAction = status.state === 'CHECKOUT_REQUIRED' || status.state === 'CHECKOUT_RESUME_REQUIRED' || status.state === 'CHECKOUT_PENDING';
  const statusAction = status.state === 'CHECKOUT_PENDING' || status.state === 'WAIT_FOR_PROVIDER' || status.state === 'READY_TO_CLOSE';

  return <div className="sf-booking-modification-form">
    <p>An expired price-changing amendment still has payment evidence. SF keeps the booking snapshot and target inventory recovery boundary protected until authoritative settlement is restored.</p>
    <div className="sf-inventory-summary">
      <div><span>Recovery state</span><strong>{status.state.toLowerCase().replaceAll('_', ' ')}</strong></div>
      <div><span>Provider</span><strong>{status.providerCode ?? '—'}</strong></div>
      <div><span>Required operation</span><strong>{status.operation?.toLowerCase().replaceAll('_', ' ') ?? '—'}</strong></div>
      <div><span>Amount</span><strong>{status.amountDisplay ?? '—'}</strong></div>
    </div>
    <p>{status.reason}</p>
    {returnState === 'cancelled' ? <p className="sf-muted"><small>Leaving Checkout does not prove that no payment occurred. SF always checks Stripe before allowing another attempt.</small></p> : null}
    {notice ? <p className="sf-booking-modification-form__success" role="status">{notice}</p> : null}
    {error ? <p className="sf-booking-modification-form__error" role="alert">{error}</p> : null}
    <div className="sf-actions">
      {checkoutAction ? <button className="sf-button sf-button--primary" type="button" onClick={startCheckout} disabled={starting || checking}>{starting ? 'Opening secure Checkout…' : status.state === 'CHECKOUT_REQUIRED' ? 'Open secure Stripe Checkout' : 'Resume secure Stripe Checkout'}</button> : null}
      {statusAction ? <button className="sf-button sf-button--secondary" type="button" onClick={checkStatus} disabled={checking || starting}>{checking ? 'Checking Stripe…' : status.state === 'READY_TO_CLOSE' ? 'Finish recovery' : 'Check Stripe status'}</button> : null}
    </div>
    {status.state === 'RECOVERY_REQUIRED' || status.state === 'CONFLICT' ? <p className="sf-muted"><small>This recovery state does not permit a customer Checkout action. Resolve the server-derived provider operation or conflict before moving more money.</small></p> : null}
  </div>;
}
