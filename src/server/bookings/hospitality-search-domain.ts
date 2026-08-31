import { formatAvailabilityDate, parseAvailabilityDate } from '../availability/availability-domain.ts';

export type HospitalityOfferSearchInput = {
  arrivalDate: string;
  departureDate: string;
  quantity: string | number;
  propertyId?: string | null;
};

export function normalizeHospitalityOfferSearchInput(input: HospitalityOfferSearchInput) {
  const arrivalDateValue = parseAvailabilityDate(input.arrivalDate, 'Arrival date');
  const departureDateValue = parseAvailabilityDate(input.departureDate, 'Departure date');
  if (departureDateValue <= arrivalDateValue) throw new Error('Departure date must be after arrival date.');
  const stayNights = Math.round((departureDateValue.getTime() - arrivalDateValue.getTime()) / 86_400_000);
  if (stayNights > 365) throw new Error('Stay length cannot exceed 365 nights.');
  if (typeof input.quantity === 'string' && !/^\d+$/.test(input.quantity.trim())) throw new Error('Quantity must be between 1 and 50.');
  const quantity = typeof input.quantity === 'number' ? input.quantity : Number(input.quantity.trim());
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 50) throw new Error('Quantity must be between 1 and 50.');
  const propertyId = input.propertyId?.trim() || null;
  return {
    arrivalDate: formatAvailabilityDate(arrivalDateValue),
    departureDate: formatAvailabilityDate(departureDateValue),
    arrivalDateValue,
    departureDateValue,
    stayNights,
    quantity,
    propertyId,
  };
}
