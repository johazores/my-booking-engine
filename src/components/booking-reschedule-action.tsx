'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type BookingRescheduleActionProps = {
  bookingId: string;
  bookingStatus: string;
  arrivalDate: string;
  departureDate: string;
};

export function BookingRescheduleAction({ bookingId, bookingStatus, arrivalDate, departureDate }: BookingRescheduleActionProps) {
  const router = useRouter();
  const [nextArrivalDate, setNextArrivalDate] = useState(arrivalDate);
  const [nextDepartureDate, setNextDepartureDate] = useState(departureDate);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (bookingStatus !== 'CONFIRMED') {
    return <div className="sf-empty-state"><h3>Rescheduling unavailable</h3><p>Only confirmed reservations can be rescheduled.</p></div>;
  }

  function changeArrival(value: string) {
    setNextArrivalDate(value);
    setIdempotencyKey(null);
    setError(null);
  }

  function changeDeparture(value: string) {
    setNextDepartureDate(value);
    setIdempotencyKey(null);
    setError(null);
  }

  async function rescheduleBooking(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (nextArrivalDate === arrivalDate && nextDepartureDate === departureDate) {
      setError('Choose different stay dates before rescheduling.');
      return;
    }

    setSubmitting(true);
    setError(null);
    const requestKey = idempotencyKey ?? `reschedule:${crypto.randomUUID()}`;
    if (!idempotencyKey) setIdempotencyKey(requestKey);
    try {
      const response = await fetch(`/api/bookings/hospitality/${bookingId}/reschedule`, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ arrivalDate: nextArrivalDate, departureDate: nextDepartureDate, idempotencyKey: requestKey }),
      });
      const payload = await response.json().catch(() => null) as { message?: string } | null;
      if (!response.ok) throw new Error(payload?.message ?? 'Booking reschedule failed.');
      setIdempotencyKey(null);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Booking reschedule failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return <form className="sf-booking-reschedule-form" onSubmit={rescheduleBooking}>
    <p>Availability, stay restrictions, and the complete persisted price are revalidated on the server. A change is applied only when the commercial total and its stored breakdown remain unchanged; price-changing requests stop before inventory or booking state is mutated.</p>
    <div className="sf-booking-reschedule-form__dates">
      <label><span>New arrival</span><input type="date" value={nextArrivalDate} onChange={(event) => changeArrival(event.target.value)} required disabled={submitting} /></label>
      <label><span>New departure</span><input type="date" value={nextDepartureDate} onChange={(event) => changeDeparture(event.target.value)} required disabled={submitting} /></label>
    </div>
    {error ? <p className="sf-booking-reschedule-form__error" role="alert">{error}</p> : null}
    <div className="sf-actions"><button className="sf-button sf-button--secondary" type="submit" disabled={submitting}>{submitting ? 'Revalidating…' : 'Reschedule booking'}</button></div>
  </form>;
}
