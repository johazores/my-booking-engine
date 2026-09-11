import type { TravelportStaysCreateExpectedReservation } from './travelport-stays-reservation-create-outcome.ts';

function validLocalDate(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Copies caller-owned reservation identity into an immutable provider-bound snapshot.
 * Every authoritative property is read once before validation so later caller mutation
 * cannot change the stay identity used after an asynchronous provider boundary.
 * Hostile/revoked proxies and throwing accessors fail closed as invalid authority.
 */
export function materializeTravelportStaysCreateExpectedReservation(
  value: unknown,
): TravelportStaysCreateExpectedReservation | null {
  let snapshot: Readonly<Record<string, unknown>>;
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const expected = value as Record<string, unknown>;
    snapshot = Object.freeze({
      chainCode: expected.chainCode,
      propertyCode: expected.propertyCode,
      arrivalDateLocal: expected.arrivalDateLocal,
      departureDateLocal: expected.departureDateLocal,
      rooms: expected.rooms,
      guests: expected.guests,
    });
  } catch {
    return null;
  }

  if (
    typeof snapshot.chainCode !== 'string'
    || !/^[A-Za-z0-9]{1,16}$/.test(snapshot.chainCode)
    || typeof snapshot.propertyCode !== 'string'
    || !/^[A-Za-z0-9]{1,32}$/.test(snapshot.propertyCode)
    || typeof snapshot.arrivalDateLocal !== 'string'
    || !validLocalDate(snapshot.arrivalDateLocal)
    || typeof snapshot.departureDateLocal !== 'string'
    || !validLocalDate(snapshot.departureDateLocal)
    || snapshot.departureDateLocal <= snapshot.arrivalDateLocal
    || snapshot.rooms !== 1
    || !Number.isInteger(snapshot.guests)
    || (snapshot.guests as number) < 1
    || (snapshot.guests as number) > 9
  ) {
    return null;
  }

  return snapshot as TravelportStaysCreateExpectedReservation;
}
