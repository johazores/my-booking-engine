'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

type AddonSelection = { addonId: string; quantity: number };
type Assignment = { roomTypeId: string; ratePlanId: string; roomType: { name: string; maxOccupancy: number }; ratePlan: { name: string } };
type AddonOption = { id: string; code: string; name: string; pricingModel: string; maxQuantity: number; roomTypeId: string | null; ratePlanId: string | null };
type OptionsResponse = { bookingId: string; status: string; assignments: Assignment[]; addons: AddonOption[] };

function selectionKey(roomTypeId: string, ratePlanId: string) { return `${roomTypeId}:${ratePlanId}`; }
function addonApplies(addon: AddonOption, roomTypeId: string, ratePlanId: string) {
  return (addon.roomTypeId === null && addon.ratePlanId === null) || (addon.roomTypeId === roomTypeId && addon.ratePlanId === ratePlanId);
}
function canonicalAddonSelections(selections: AddonSelection[]) {
  return [...selections].sort((left, right) => left.addonId.localeCompare(right.addonId)).map((selection) => ({ addonId: selection.addonId, quantity: selection.quantity }));
}

export function BookingCommercialModificationAction(props: {
  bookingId: string;
  bookingStatus: string;
  roomTypeId: string;
  ratePlanId: string;
  quantity: number;
  addonSelections: AddonSelection[];
}) {
  const router = useRouter();
  const [options, setOptions] = useState<OptionsResponse | null>(null);
  const [roomTypeId, setRoomTypeId] = useState(props.roomTypeId);
  const [ratePlanId, setRatePlanId] = useState(props.ratePlanId);
  const [quantity, setQuantity] = useState(props.quantity);
  const [addonSelections, setAddonSelections] = useState<AddonSelection[]>(canonicalAddonSelections(props.addonSelections));
  const [loading, setLoading] = useState(props.bookingStatus === 'CONFIRMED');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const idempotencyKey = useRef<string | null>(null);

  useEffect(() => {
    if (props.bookingStatus !== 'CONFIRMED') return;
    let active = true;
    void fetch(`/api/bookings/hospitality/${props.bookingId}/modify`, { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message ?? payload.error ?? 'Commercial booking options could not be loaded.');
        if (!active) return;
        const nextOptions = payload as OptionsResponse;
        setOptions(nextOptions);
        const currentAssignmentExists = nextOptions.assignments.some((assignment) => assignment.roomTypeId === props.roomTypeId && assignment.ratePlanId === props.ratePlanId);
        const fallbackAssignment = currentAssignmentExists ? null : nextOptions.assignments[0] ?? null;
        const effectiveRoomTypeId = fallbackAssignment?.roomTypeId ?? props.roomTypeId;
        const effectiveRatePlanId = fallbackAssignment?.ratePlanId ?? props.ratePlanId;
        if (fallbackAssignment) { setRoomTypeId(fallbackAssignment.roomTypeId); setRatePlanId(fallbackAssignment.ratePlanId); }
        setAddonSelections((current) => canonicalAddonSelections(current.filter((selection) => {
          const addon = nextOptions.addons.find((option) => option.id === selection.addonId);
          return addon ? addonApplies(addon, effectiveRoomTypeId, effectiveRatePlanId) : false;
        })));
      })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Commercial booking options could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [props.bookingId, props.bookingStatus, props.ratePlanId, props.roomTypeId]);

  const availableAddons = useMemo(() => options?.addons.filter((addon) => addonApplies(addon, roomTypeId, ratePlanId)) ?? [], [options, ratePlanId, roomTypeId]);
  const normalizedCurrent = useMemo(() => JSON.stringify({ roomTypeId: props.roomTypeId, ratePlanId: props.ratePlanId, quantity: props.quantity, addonSelections: canonicalAddonSelections(props.addonSelections) }), [props.addonSelections, props.quantity, props.ratePlanId, props.roomTypeId]);
  const normalizedDraft = JSON.stringify({ roomTypeId, ratePlanId, quantity, addonSelections: canonicalAddonSelections(addonSelections) });
  const hasChanges = normalizedCurrent !== normalizedDraft;

  function resetRetryIdentity() { idempotencyKey.current = null; setError(''); setSuccess(''); }
  function changeAssignment(value: string) {
    const [nextRoomTypeId, nextRatePlanId] = value.split(':');
    if (!nextRoomTypeId || !nextRatePlanId) return;
    resetRetryIdentity(); setRoomTypeId(nextRoomTypeId); setRatePlanId(nextRatePlanId);
    setAddonSelections((current) => canonicalAddonSelections(current.filter((selection) => {
      const addon = options?.addons.find((option) => option.id === selection.addonId);
      return addon ? addonApplies(addon, nextRoomTypeId, nextRatePlanId) : false;
    })));
  }
  function toggleAddon(addon: AddonOption, checked: boolean) {
    resetRetryIdentity();
    setAddonSelections((current) => checked ? canonicalAddonSelections([...current.filter((selection) => selection.addonId !== addon.id), { addonId: addon.id, quantity: 1 }]) : current.filter((selection) => selection.addonId !== addon.id));
  }
  function changeAddonQuantity(addon: AddonOption, value: number) {
    resetRetryIdentity();
    const normalized = Number.isSafeInteger(value) ? Math.min(Math.max(value, 1), addon.maxQuantity) : 1;
    setAddonSelections((current) => canonicalAddonSelections(current.map((selection) => selection.addonId === addon.id ? { ...selection, quantity: normalized } : selection)));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hasChanges || submitting || loading || props.bookingStatus !== 'CONFIRMED') return;
    setSubmitting(true); setError(''); setSuccess(''); idempotencyKey.current ??= `commercial:${crypto.randomUUID()}`;
    try {
      const response = await fetch(`/api/bookings/hospitality/${props.bookingId}/modify`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ roomTypeId, ratePlanId, quantity, addonSelections: canonicalAddonSelections(addonSelections), idempotencyKey: idempotencyKey.current }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message ?? payload.error ?? 'Commercial booking changes could not be applied.');
      idempotencyKey.current = null; setSuccess('Commercial booking terms were updated. Refreshing the booking record…'); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Commercial booking changes could not be applied.'); }
    finally { setSubmitting(false); }
  }

  if (props.bookingStatus !== 'CONFIRMED') return <p className="sf-muted">Commercial terms can only be changed while the booking is confirmed.</p>;

  return <form className="sf-booking-modification-form" onSubmit={submit}>
    <p>Room, rate, quantity, and add-on changes are revalidated against live inventory, restrictions, occupancy, and current pricing. SF applies this safe path only when every monetary component remains unchanged.</p>
    {loading ? <p className="sf-muted" role="status">Loading eligible commercial terms…</p> : null}
    {error ? <p className="sf-booking-modification-form__error" role="alert">{error}</p> : null}
    {success ? <p className="sf-booking-modification-form__success" role="status">{success}</p> : null}
    {options && options.assignments.length === 0 ? <div className="sf-empty-state"><h3>No eligible commercial terms</h3><p>No active room type and rate-plan assignments are available for this property.</p></div> : null}
    {options && options.assignments.length > 0 ? <>
      <div className="sf-booking-modification-form__grid">
        <label><span>Room type and rate plan</span><select value={selectionKey(roomTypeId, ratePlanId)} onChange={(event) => changeAssignment(event.target.value)} disabled={submitting}>{options.assignments.map((assignment) => <option key={selectionKey(assignment.roomTypeId, assignment.ratePlanId)} value={selectionKey(assignment.roomTypeId, assignment.ratePlanId)}>{assignment.roomType.name} · {assignment.ratePlan.name} · up to {assignment.roomType.maxOccupancy} guests/room</option>)}</select></label>
        <label><span>Rooms</span><input type="number" min={1} max={50} step={1} value={quantity} onChange={(event) => { resetRetryIdentity(); setQuantity(Number(event.target.value)); }} disabled={submitting} /></label>
      </div>
      <fieldset className="sf-booking-modification-form__addons"><legend>Add-ons</legend>{availableAddons.length === 0 ? <p className="sf-muted">No active add-ons apply to this room and rate for the booked stay.</p> : availableAddons.map((addon) => {
        const selected = addonSelections.find((selection) => selection.addonId === addon.id);
        return <div className="sf-booking-modification-addon" key={addon.id}><label><input type="checkbox" checked={Boolean(selected)} onChange={(event) => toggleAddon(addon, event.target.checked)} disabled={submitting} /><span><strong>{addon.name}</strong><small>{addon.code} · {addon.pricingModel.toLowerCase().replaceAll('_', ' ')}</small></span></label>{selected ? <label className="sf-booking-modification-addon__quantity"><span>Quantity</span><input type="number" min={1} max={addon.maxQuantity} step={1} value={selected.quantity} onChange={(event) => changeAddonQuantity(addon, Number(event.target.value))} disabled={submitting} /></label> : null}</div>;
      })}</fieldset>
      <div className="sf-actions"><button className="sf-button sf-button--primary" type="submit" disabled={!hasChanges || submitting || loading}>{submitting ? 'Applying changes…' : 'Apply commercial changes'}</button></div>
      <p className="sf-muted"><small>If the recalculated price changes, SF rejects the edit instead of silently changing the amount owed or paid. A separate payment-adjustment workflow is required for non-zero deltas.</small></p>
    </> : null}
  </form>;
}
