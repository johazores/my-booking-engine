'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type BookingCancelActionProps = {
  bookingId: string;
  bookingStatus: string;
  paymentBlockReason: string | null;
};

export function BookingCancelAction({ bookingId, bookingStatus, paymentBlockReason }: BookingCancelActionProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (bookingStatus === 'CANCELLED') {
    return <div className="sf-empty-state"><h3>Booking cancelled</h3><p>This reservation no longer consumes sellable inventory.</p></div>;
  }

  if (paymentBlockReason) {
    return <div className="sf-empty-state"><h3>Cancellation requires payment resolution</h3><p>{paymentBlockReason}</p></div>;
  }

  async function cancelBooking() {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/bookings/hospitality/${bookingId}/cancel`, {
        method: 'POST',
        headers: { accept: 'application/json' },
      });
      const payload = await response.json().catch(() => null) as { message?: string } | null;
      if (!response.ok) throw new Error(payload?.message ?? 'Booking cancellation failed.');
      setConfirming(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Booking cancellation failed.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!confirming) {
    return <div className="sf-actions"><button className="sf-button sf-button--secondary" type="button" onClick={() => setConfirming(true)}>Cancel booking</button></div>;
  }

  return <div className="sf-empty-state" role="group" aria-labelledby="cancel-booking-title">
    <h3 id="cancel-booking-title">Confirm cancellation</h3>
    <p>This permanently cancels the reservation and releases its inventory. The booking record and audit history are retained.</p>
    {error ? <p role="alert">{error}</p> : null}
    <div className="sf-actions">
      <button className="sf-button" type="button" disabled={submitting} onClick={cancelBooking}>{submitting ? 'Cancelling…' : 'Confirm cancellation'}</button>
      <button className="sf-button sf-button--secondary" type="button" disabled={submitting} onClick={() => { setConfirming(false); setError(null); }}>Keep booking</button>
    </div>
  </div>;
}
