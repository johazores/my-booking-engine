import { rentalLocalDateKey } from '../inventory/rental-custody-availability.ts';
import { RentalBookingFulfillmentIntegrityError } from './rental-booking-fulfillment-domain.ts';

export type RentalBookingPickupWindowState = 'BEFORE_WINDOW' | 'OPEN' | 'CLOSED';

function dateKey(date: Date, label: string) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new RentalBookingFulfillmentIntegrityError(`Rental pickup ${label} date is invalid.`);
  }
  return date.toISOString().slice(0, 10);
}

export function deriveRentalBookingPickupWindow(input: Readonly<{
  observedAt: Date;
  startsOn: Date;
  endsOn: Date;
  timeZone: string;
}>) {
  const startsOn = dateKey(input.startsOn, 'start');
  const endsOn = dateKey(input.endsOn, 'end');
  if (startsOn >= endsOn) {
    throw new RentalBookingFulfillmentIntegrityError(
      'Rental pickup window requires a valid exclusive-end rental period.',
    );
  }

  const observedLocalDate = rentalLocalDateKey(input.observedAt, input.timeZone);
  const state: RentalBookingPickupWindowState = observedLocalDate < startsOn
    ? 'BEFORE_WINDOW'
    : observedLocalDate >= endsOn
      ? 'CLOSED'
      : 'OPEN';

  return Object.freeze({ state, observedLocalDate, startsOn, endsOn });
}
