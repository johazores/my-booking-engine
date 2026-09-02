'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

type RefundAvailability =
  | {
    available: true;
    providerCode: 'manual' | 'stripe';
    refundableAmount: string;
    bookingRefundableAmount: string;
    refundableSourceCount: number;
    sourceReference: string | null;
    requiresReference: boolean;
  }
  | { available: false; reason: string };

type RefundResponse = {
  message?: string;
  error?: string;
  retryable?: boolean;
  status?: string;
};

export function BookingRefundAction(props: {
  bookingId: string;
  availability: RefundAvailability;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useRef<string | null>(null);

  if (!props.availability.available) {
    return <div className="sf-empty-state"><h3>Refund unavailable</h3><p>{props.availability.reason}</p></div>;
  }

  const availability = props.availability;
  const providerLabel = availability.providerCode === 'stripe' ? 'Stripe' : 'manual payment';

  function resetConfirmation() {
    if (submitting) return;
    setConfirming(false);
    setError(null);
    idempotencyKey.current = null;
  }

  async function submitRefund(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const normalizedReference = reference.trim();
    if (availability.requiresReference && !normalizedReference) {
      setError('External refund reference is required for a manual refund.');
      return;
    }

    setSubmitting(true);
    setError(null);
    idempotencyKey.current ??= `refund:${crypto.randomUUID()}`;
    const endpoint = availability.providerCode === 'stripe'
      ? '/api/payments/stripe/refunds'
      : '/api/payments/manual/refunds';

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          bookingId: props.bookingId,
          idempotencyKey: idempotencyKey.current,
          ...(availability.requiresReference ? { reference: normalizedReference } : {}),
        }),
      });
      const payload = await response.json().catch(() => null) as RefundResponse | null;
      if (!response.ok) {
        if (payload?.retryable === false) idempotencyKey.current = null;
        throw new Error(payload?.message ?? payload?.error ?? 'Refund could not be completed.');
      }
      if (payload?.status === 'FAILED') {
        idempotencyKey.current = null;
        throw new Error('The refund was definitively rejected and no funds were marked refunded. You can try again with a new refund request.');
      }
      idempotencyKey.current = null;
      setConfirming(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Refund could not be completed.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!confirming) {
    return <div>
      <p>Total remaining refundable balance: <strong>{availability.bookingRefundableAmount}</strong>.</p>
      <p>Next refund operation: <strong>{availability.refundableAmount}</strong> through {providerLabel}.</p>
      {availability.sourceReference ? <p>External payment source: <strong>{availability.sourceReference}</strong>.</p> : null}
      {availability.refundableSourceCount > 1
        ? <p><small>{availability.refundableSourceCount} refundable settlement sources remain. SF processes one authoritative source at a time; after this operation, refresh will expose the next safe refund.</small></p>
        : null}
      <div className="sf-actions"><button className="sf-button sf-button--secondary" type="button" onClick={() => { setConfirming(true); setError(null); }}>Review refund</button></div>
    </div>;
  }

  return <form className="sf-booking-modification-form" onSubmit={submitRefund} aria-labelledby="booking-refund-confirm-title">
    <h3 id="booking-refund-confirm-title">Confirm refund</h3>
    <p>You are refunding <strong>{availability.refundableAmount}</strong> through {providerLabel}.</p>
    {availability.providerCode === 'stripe'
      ? <p>This sends a real refund request through the configured Stripe integration. SF will retain the payment transaction and audit trail.</p>
      : <p>First complete this exact refund against external payment source <strong>{availability.sourceReference}</strong>, then record its external refund reference below. SF will bind the refund to that settlement source as authoritative payment history.</p>}
    {availability.requiresReference ? <label><span>External refund reference</span><input type="text" maxLength={120} value={reference} onChange={(event) => { setReference(event.target.value); idempotencyKey.current = null; setError(null); }} disabled={submitting} autoComplete="off" required /></label> : null}
    {error ? <p className="sf-booking-modification-form__error" role="alert">{error}</p> : null}
    <div className="sf-actions">
      <button className="sf-button sf-button--primary" type="submit" disabled={submitting}>{submitting ? 'Processing refund…' : 'Confirm refund'}</button>
      <button className="sf-button sf-button--secondary" type="button" disabled={submitting} onClick={resetConfirmation}>Keep payment</button>
    </div>
  </form>;
}
