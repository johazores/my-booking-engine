export type RentalBookingFulfillmentEventKind = 'PICKED_UP' | 'RETURNED';
export type RentalBookingFulfillmentState = 'AWAITING_PICKUP' | 'PICKED_UP' | 'RETURNED';

export type RentalBookingFulfillmentEventEvidence = Readonly<{
  kind: RentalBookingFulfillmentEventKind;
  occurredAt: Date;
}>;

export class RentalBookingFulfillmentIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RentalBookingFulfillmentIntegrityError';
  }
}

export function rentalBookingFulfillmentIdempotencyKey(
  bookingId: string,
  kind: RentalBookingFulfillmentEventKind,
) {
  return `rental-fulfillment:${bookingId}:${kind.toLowerCase()}`;
}

export function deriveRentalBookingFulfillmentState(
  events: readonly RentalBookingFulfillmentEventEvidence[],
) {
  let pickedUpAt: Date | null = null;
  let returnedAt: Date | null = null;

  for (const event of events) {
    if (!(event.occurredAt instanceof Date) || Number.isNaN(event.occurredAt.getTime())) {
      throw new RentalBookingFulfillmentIntegrityError('Rental fulfillment evidence has an invalid event timestamp.');
    }
    if (event.kind === 'PICKED_UP') {
      if (pickedUpAt) {
        throw new RentalBookingFulfillmentIntegrityError('Rental fulfillment evidence contains duplicate pickup events.');
      }
      if (returnedAt) {
        throw new RentalBookingFulfillmentIntegrityError('Rental pickup evidence cannot follow return evidence.');
      }
      pickedUpAt = event.occurredAt;
      continue;
    }
    if (event.kind === 'RETURNED') {
      if (!pickedUpAt) {
        throw new RentalBookingFulfillmentIntegrityError('Rental return evidence requires an earlier pickup event.');
      }
      if (returnedAt) {
        throw new RentalBookingFulfillmentIntegrityError('Rental fulfillment evidence contains duplicate return events.');
      }
      if (event.occurredAt.getTime() < pickedUpAt.getTime()) {
        throw new RentalBookingFulfillmentIntegrityError('Rental return evidence cannot predate pickup evidence.');
      }
      returnedAt = event.occurredAt;
      continue;
    }
    const exhaustive: never = event.kind;
    throw new RentalBookingFulfillmentIntegrityError(`Unsupported rental fulfillment event: ${exhaustive}`);
  }

  const state: RentalBookingFulfillmentState = returnedAt
    ? 'RETURNED'
    : pickedUpAt
      ? 'PICKED_UP'
      : 'AWAITING_PICKUP';

  return Object.freeze({ state, pickedUpAt, returnedAt });
}
