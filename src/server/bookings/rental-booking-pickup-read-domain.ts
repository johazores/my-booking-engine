import type { RentalBookingFulfillmentState } from './rental-booking-fulfillment-domain.ts';
import { deriveRentalBookingPickupWindow } from './rental-booking-pickup-window-domain.ts';

export function deriveRentalBookingPickupReadState(input: Readonly<{
  bookingStatus: 'CONFIRMED' | 'CANCELLED';
  fulfillmentState: RentalBookingFulfillmentState;
  observedAt: Date;
  startsOn: Date;
  endsOn: Date;
  timeZone: string;
}>) {
  const window = deriveRentalBookingPickupWindow({
    observedAt: input.observedAt,
    startsOn: input.startsOn,
    endsOn: input.endsOn,
    timeZone: input.timeZone,
  });

  return Object.freeze({
    window,
    missed: input.bookingStatus === 'CONFIRMED'
      && input.fulfillmentState === 'AWAITING_PICKUP'
      && window.state === 'CLOSED',
  });
}
