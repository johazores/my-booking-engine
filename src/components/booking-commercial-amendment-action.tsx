'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

type CommercialAmendmentStatus = Readonly<{
  bookingId: string;
  amendmentId: string;
  amendmentStatus: string;
  direction: 'ADDITIONAL_CHARGE' | 'REFUND';
  providerCode: string;
  currency: string;
  deltaDisplay: string;
  expiresAt: string;
  state:
    | 'MANUAL_SETTLEMENT_REQUIRED'
    | 'STRIPE_REFUND_REQUIRED'
    | 'STRIPE_CUSTOMER_AUTHORIZATION_REQUIRED'
    | 'WAIT_FOR_PROVIDER'
    | 'READY_TO_APPLY'
    | 'RECOVERY_REQUIRED'
    | 'EXPIRED'
    | 'APPLIED'
    | 'CANCELLED'
    | 'CONFLICT';
  reason: string;
  operation: 'ADDITIONAL_CHARGE' | 'REFUND' | null;
  amountDisplay: string | null;
  sourceProviderReference: string | null;
  refundableSourceCount: number | null;
  canCancel: boolean;
  canApply: boolean;
}>;

function requestKey(prefix: string) {
  return `${prefix}:${crypto.randomUUID()}`;
}

async function readJson(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message ?? payload.error ?? 'Commercial amendment operation could not be completed.');
  return payload as CommercialAmendmentStatus;
}

export function BookingCommercialAmendmentAction(props: {
  bookingId: string;
  initialStatus: CommercialAmendmentStatus;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(props.initialStatus);
  const [externalReference, setExternalReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const manualIdempotencyKey = useRef<string | null>(null);
  const stripeRefundIdempotencyKey = useRef<string | null>(null);
  const endpoint = `/api/bookings/hospitality/${props.bookingId}/commercial-amendments/${status.amendmentId}`;

  function accept(next: CommercialAmendmentStatus, message: string) {
    setStatus(next);
    setError('');
    setNotice(message);
    if (next.state === 'MANUAL_SETTLEMENT_REQUIRED') {
      manualIdempotencyKey.current = null;
      setExternalReference('');
    }
    if (next.state === 'STRIPE_REFUND_REQUIRED') stripeRefundIdempotencyKey.current = null;
    if (next.state === 'APPLIED' || next.state === 'CANCELLED' || next.state === 'EXPIRED' || next.state === 'RECOVERY_REQUIRED') {
      router.refresh();
    }
  }

  async function refreshStatus() {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = status.providerCode === 'stripe' && status.direction === 'REFUND' && status.state === 'WAIT_FOR_PROVIDER'
        ? await fetch(`${endpoint}/stripe-refund/status`, { method: 'POST', headers: { Accept: 'application/json' } })
        : await fetch(endpoint, { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store' });
      const next = await readJson(response);
      accept(next, next.state === 'READY_TO_APPLY' ? 'Provider settlement is confirmed. The reviewed booking change is ready for final apply.' : 'Commercial amendment status refreshed from authoritative server state.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Commercial amendment status could not be refreshed.');
    } finally {
      setBusy(false);
    }
  }

  async function recordManualSettlement(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reference = externalReference.trim();
    if (!reference || busy || status.state !== 'MANUAL_SETTLEMENT_REQUIRED') return;
    setBusy(true); setError(''); setNotice('');
    manualIdempotencyKey.current ??= requestKey('commercial-manual');
    try {
      const response = await fetch(`${endpoint}/manual-settlement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ idempotencyKey: manualIdempotencyKey.current, externalReference: reference }),
      });
      const next = await readJson(response);
      const message = next.state === 'MANUAL_SETTLEMENT_REQUIRED'
        ? 'External settlement recorded. Another source-scoped operation is still required before the amendment can apply.'
        : 'External settlement recorded and reconciled.';
      accept(next, message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'External settlement could not be recorded. Retry uses the same operation identity.');
    } finally {
      setBusy(false);
    }
  }

  async function executeStripeRefund() {
    if (busy || status.state !== 'STRIPE_REFUND_REQUIRED') return;
    setBusy(true); setError(''); setNotice('');
    stripeRefundIdempotencyKey.current ??= requestKey('commercial-stripe-refund');
    try {
      const response = await fetch(`${endpoint}/stripe-refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ idempotencyKey: stripeRefundIdempotencyKey.current }),
      });
      const next = await readJson(response);
      accept(next, next.state === 'WAIT_FOR_PROVIDER'
        ? 'Stripe accepted the refund operation but final provider status is not yet authoritative. Reconcile before continuing.'
        : next.state === 'STRIPE_REFUND_REQUIRED'
          ? 'Stripe refund completed for one settlement source. Another source-scoped refund remains.'
          : 'Stripe refund settlement completed.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Stripe refund could not be completed. Retry uses the same operation identity.');
    } finally {
      setBusy(false);
    }
  }

  async function applyAmendment() {
    if (busy || !status.canApply) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`${endpoint}/apply`, { method: 'POST', headers: { Accept: 'application/json' } });
      const next = await readJson(response);
      accept(next, 'Commercial amendment applied. Booking terms, allocation, immutable pricing, and payment state were committed together.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Commercial amendment could not be applied.');
    } finally {
      setBusy(false);
    }
  }

  async function cancelAmendment() {
    if (busy || !status.canCancel) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`${endpoint}/cancel`, { method: 'POST', headers: { Accept: 'application/json' } });
      const next = await readJson(response);
      accept(next, 'Prepared commercial amendment cancelled and its target inventory protection released.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Commercial amendment could not be cancelled.');
    } finally {
      setBusy(false);
    }
  }

  const refundSourceMessage = status.operation === 'REFUND' && status.sourceProviderReference
    ? `Settlement source ${status.sourceProviderReference}${status.refundableSourceCount && status.refundableSourceCount > 1 ? ` · ${status.refundableSourceCount} refundable sources remain` : ''}.`
    : null;

  return <div className="sf-booking-modification-form">
    <p>{status.reason}</p>
    <div className="sf-inventory-summary">
      <div><span>Adjustment</span><strong>{status.direction === 'REFUND' ? 'Refund' : 'Additional charge'} · {status.deltaDisplay}</strong></div>
      <div><span>Provider</span><strong>{status.providerCode}</strong></div>
      <div><span>Expires</span><strong>{status.expiresAt}</strong></div>
      <div><span>State</span><strong>{status.state.toLowerCase().replaceAll('_', ' ')}</strong></div>
    </div>
    {status.amountDisplay ? <p><strong>Next exact settlement amount:</strong> {status.amountDisplay}</p> : null}
    {refundSourceMessage ? <p className="sf-muted"><small>{refundSourceMessage}</small></p> : null}
    {notice ? <p className="sf-booking-modification-form__success" role="status">{notice}</p> : null}
    {error ? <p className="sf-booking-modification-form__error" role="alert">{error}</p> : null}

    {status.state === 'MANUAL_SETTLEMENT_REQUIRED' ? <form onSubmit={recordManualSettlement}>
      <p>{status.direction === 'REFUND'
        ? 'Complete this exact refund outside SF against the source above. Record only the real external refund reference after the money operation succeeds.'
        : 'Receive this exact amount outside SF first. Record only the real external payment reference after the money operation succeeds.'}</p>
      <label className="sf-field"><span>External {status.direction === 'REFUND' ? 'refund' : 'payment'} reference</span><input value={externalReference} onChange={(event) => setExternalReference(event.target.value)} maxLength={160} autoComplete="off" disabled={busy} required /></label>
      <div className="sf-actions"><button className="sf-button sf-button--primary" type="submit" disabled={busy || !externalReference.trim()}>{busy ? 'Recording…' : `Record completed ${status.direction === 'REFUND' ? 'refund' : 'payment'}`}</button></div>
    </form> : null}

    {status.state === 'STRIPE_REFUND_REQUIRED' ? <div>
      <p>SF will derive the source and amount again under the booking/payment locks before asking Stripe to refund it. The browser cannot override either value.</p>
      <button className="sf-button sf-button--primary" type="button" onClick={executeStripeRefund} disabled={busy}>{busy ? 'Refunding…' : 'Issue exact Stripe refund'}</button>
    </div> : null}

    {status.state === 'STRIPE_CUSTOMER_AUTHORIZATION_REQUIRED' ? <p className="sf-booking-modification-form__error">This prepared increase needs a fresh customer-authorized Stripe payment. SF does not reuse old card credentials or treat the prepared delta as permission to charge. Cancel this amendment unless the customer-authorized collection flow is being completed through a supported internal operation.</p> : null}

    {status.state === 'WAIT_FOR_PROVIDER' ? <div>
      <p>Provider truth is still unresolved. Do not apply the booking change or start another money operation until reconciliation finishes.</p>
      {status.providerCode === 'stripe' && status.direction === 'REFUND' ? <button className="sf-button sf-button--primary" type="button" onClick={refreshStatus} disabled={busy}>{busy ? 'Checking Stripe…' : 'Check Stripe status'}</button> : null}
    </div> : null}

    {status.state === 'READY_TO_APPLY' ? <div>
      <p className="sf-booking-modification-form__success">The adjustment ledger is fully settled. Final apply will revalidate booking version, target inventory, pricing, hold identity, and settlement inside the serializable transaction.</p>
      <button className="sf-button sf-button--primary" type="button" onClick={applyAmendment} disabled={busy}>{busy ? 'Applying…' : 'Apply settled booking change'}</button>
    </div> : null}

    {status.state === 'CONFLICT' || status.state === 'RECOVERY_REQUIRED' || status.state === 'EXPIRED' ? <p className="sf-booking-modification-form__error">Do not move more money from this panel. Refresh authoritative state and use recovery/operator reconciliation where required.</p> : null}

    <div className="sf-actions">
      {status.canCancel ? <button className="sf-button sf-button--secondary" type="button" onClick={cancelAmendment} disabled={busy}>{busy ? 'Working…' : 'Cancel prepared change'}</button> : null}
      {status.state !== 'READY_TO_APPLY' && status.state !== 'WAIT_FOR_PROVIDER' ? <button className="sf-button sf-button--secondary" type="button" onClick={refreshStatus} disabled={busy}>{busy ? 'Refreshing…' : 'Refresh status'}</button> : null}
    </div>
  </div>;
}
