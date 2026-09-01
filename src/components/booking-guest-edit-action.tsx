'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Guest = { firstName: string; lastName: string; email: string | null };

type BookingGuestEditActionProps = {
  bookingId: string;
  bookingStatus: string;
  guests: Guest[];
  maximumGuests: number;
};

export function BookingGuestEditAction({ bookingId, bookingStatus, guests, maximumGuests }: BookingGuestEditActionProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<Guest[]>(guests);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (bookingStatus !== 'CONFIRMED') {
    return <div className="sf-empty-state"><h3>Traveler editing unavailable</h3><p>Traveler snapshots can only be edited while the booking is confirmed.</p></div>;
  }

  function mutate(next: Guest[]) {
    setDraft(next);
    setIdempotencyKey(null);
    setError(null);
  }

  function updateGuest(index: number, field: keyof Guest, value: string) {
    mutate(draft.map((guest, guestIndex) => guestIndex === index ? { ...guest, [field]: field === 'email' ? value || null : value } : guest));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const requestKey = idempotencyKey ?? `guest-edit:${crypto.randomUUID()}`;
    if (!idempotencyKey) setIdempotencyKey(requestKey);
    try {
      const response = await fetch(`/api/bookings/hospitality/${bookingId}/guests`, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ idempotencyKey: requestKey, guests: draft }),
      });
      const payload = await response.json().catch(() => null) as { message?: string } | null;
      if (!response.ok) throw new Error(payload?.message ?? 'Traveler update failed.');
      setIdempotencyKey(null);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Traveler update failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return <form className="sf-booking-reschedule-form" onSubmit={submit}>
    <p>Traveler snapshots are booking history, separate from the reusable customer record. Updates are tenant-authorized, capacity-checked, idempotent, and audited without storing traveler PII in the audit event.</p>
    <div className="sf-inventory-rooms">
      {draft.map((guest, index) => <fieldset className="sf-inventory-card" key={index} disabled={submitting}>
        <legend>Traveler {index + 1}</legend>
        <div className="sf-form sf-form--inline">
          <label className="sf-field"><span>First name</span><input value={guest.firstName} onChange={(event) => updateGuest(index, 'firstName', event.target.value)} required maxLength={80} /></label>
          <label className="sf-field"><span>Last name</span><input value={guest.lastName} onChange={(event) => updateGuest(index, 'lastName', event.target.value)} required maxLength={80} /></label>
          <label className="sf-field"><span>Email</span><input type="email" value={guest.email ?? ''} onChange={(event) => updateGuest(index, 'email', event.target.value)} maxLength={320} /></label>
        </div>
        {draft.length > 1 ? <div className="sf-actions"><button className="sf-button sf-button--secondary" type="button" onClick={() => mutate(draft.filter((_, guestIndex) => guestIndex !== index))}>Remove traveler</button></div> : null}
      </fieldset>)}
    </div>
    <p className="sf-field-hint">{draft.length} of {maximumGuests} reserved occupant{maximumGuests === 1 ? '' : 's'}.</p>
    {error ? <p className="sf-booking-reschedule-form__error" role="alert">{error}</p> : null}
    <div className="sf-actions">
      <button className="sf-button sf-button--secondary" type="button" disabled={submitting || draft.length >= maximumGuests} onClick={() => mutate([...draft, { firstName: '', lastName: '', email: null }])}>Add traveler</button>
      <button className="sf-button sf-button--primary" type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Save travelers'}</button>
    </div>
  </form>;
}
