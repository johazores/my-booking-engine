import { createHash } from 'node:crypto';

import {
  normalizeBookingIdempotencyKey,
  normalizeHospitalityBookingGuests,
  type HospitalityBookingGuestInput,
} from './booking-domain.ts';

export type HospitalityBookingGuestModificationInput = {
  idempotencyKey: string;
  guests: HospitalityBookingGuestInput[];
};

export function normalizeHospitalityBookingGuestModificationInput(input: HospitalityBookingGuestModificationInput) {
  return {
    idempotencyKey: normalizeBookingIdempotencyKey(input.idempotencyKey),
    guests: normalizeHospitalityBookingGuests(input.guests),
  };
}

export function hospitalityBookingGuestFingerprint(guests: HospitalityBookingGuestInput[]) {
  const normalized = normalizeHospitalityBookingGuests(guests);
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

export function assertHospitalityBookingGuestCapacity(input: {
  guests: HospitalityBookingGuestInput[];
  quantity: number;
  maxOccupancy: number;
}) {
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || !Number.isInteger(input.maxOccupancy) || input.maxOccupancy < 1) {
    throw new Error('Persisted booking occupancy configuration is invalid.');
  }
  const maximumGuests = input.quantity * input.maxOccupancy;
  if (input.guests.length > maximumGuests) {
    throw new Error(`Booking guests cannot exceed the reserved occupancy of ${maximumGuests}.`);
  }
  return maximumGuests;
}
