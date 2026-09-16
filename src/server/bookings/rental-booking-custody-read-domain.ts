import { rentalCustodyIsOverdue } from '../inventory/rental-custody-availability.ts';
import {
  RentalBookingFulfillmentIntegrityError,
  type RentalBookingFulfillmentEventKind,
  type RentalBookingFulfillmentState,
} from './rental-booking-fulfillment-domain.ts';

export type RentalBookingCustodyReadEvent = Readonly<{
  kind: RentalBookingFulfillmentEventKind;
  endsOn: Date;
}>;

export type RentalBookingCustodyReadState = Readonly<{
  overdue: boolean;
  observedAt: Date;
  expectedReturnOn: Date | null;
}>;

export function deriveRentalBookingCustodyReadState(input: Readonly<{
  bookingStatus: 'CONFIRMED' | 'CANCELLED';
  fulfillmentState: RentalBookingFulfillmentState;
  fulfillmentEvents: readonly RentalBookingCustodyReadEvent[];
  observedAt: Date;
  timeZone: string;
}>): RentalBookingCustodyReadState {
  if (!(input.observedAt instanceof Date) || Number.isNaN(input.observedAt.getTime())) {
    throw new RentalBookingFulfillmentIntegrityError(
      'Rental custody read evidence has an invalid database observation timestamp.',
    );
  }

  if (input.bookingStatus !== 'CONFIRMED') {
    if (input.fulfillmentState !== 'AWAITING_PICKUP' || input.fulfillmentEvents.length > 0) {
      throw new RentalBookingFulfillmentIntegrityError(
        'Cancelled rental booking custody evidence cannot include physical handoff events.',
      );
    }
    return Object.freeze({
      overdue: false,
      observedAt: input.observedAt,
      expectedReturnOn: null,
    });
  }

  if (input.fulfillmentState !== 'PICKED_UP') {
    return Object.freeze({
      overdue: false,
      observedAt: input.observedAt,
      expectedReturnOn: null,
    });
  }

  const pickup = input.fulfillmentEvents.find((event) => event.kind === 'PICKED_UP');
  if (!pickup) {
    throw new RentalBookingFulfillmentIntegrityError(
      'Picked-up rental custody state is missing its retained pickup evidence.',
    );
  }

  return Object.freeze({
    overdue: rentalCustodyIsOverdue({
      observedAt: input.observedAt,
      endsOn: pickup.endsOn,
      timeZone: input.timeZone,
    }),
    observedAt: input.observedAt,
    expectedReturnOn: pickup.endsOn,
  });
}
