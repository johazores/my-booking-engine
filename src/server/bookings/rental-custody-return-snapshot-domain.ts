export type RentalCustodySnapshotEvidence = Readonly<{
  unitId: string;
  startsOn: Date;
  endsOn: Date;
  occurredAt: Date;
}>;

export class RentalCustodySnapshotIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RentalCustodySnapshotIntegrityError';
  }
}

function requireValidDate(value: Date, label: string) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new RentalCustodySnapshotIntegrityError(`${label} is invalid.`);
  }
}

export function validateRentalCustodyReturnSnapshot(input: Readonly<{
  pickup: RentalCustodySnapshotEvidence;
  returned: RentalCustodySnapshotEvidence;
}>) {
  for (const [value, label] of [
    [input.pickup.startsOn, 'Pickup committed start'],
    [input.pickup.endsOn, 'Pickup committed end'],
    [input.pickup.occurredAt, 'Pickup timestamp'],
    [input.returned.startsOn, 'Return committed start'],
    [input.returned.endsOn, 'Return committed end'],
    [input.returned.occurredAt, 'Return timestamp'],
  ] as const) requireValidDate(value, label);

  if (input.pickup.unitId !== input.returned.unitId) {
    throw new RentalCustodySnapshotIntegrityError('Rental return evidence must retain the picked-up physical unit.');
  }
  if (input.pickup.startsOn.getTime() !== input.returned.startsOn.getTime()) {
    throw new RentalCustodySnapshotIntegrityError('Rental return evidence must retain the picked-up committed start date.');
  }
  if (input.returned.endsOn.getTime() < input.pickup.endsOn.getTime()) {
    throw new RentalCustodySnapshotIntegrityError('Rental return evidence cannot shorten the committed end retained at pickup.');
  }
  if (input.returned.occurredAt.getTime() < input.pickup.occurredAt.getTime()) {
    throw new RentalCustodySnapshotIntegrityError('Rental return evidence cannot predate pickup evidence.');
  }

  return Object.freeze({
    committedStartsOn: input.returned.startsOn,
    committedEndsOn: input.returned.endsOn,
    custodyExtended: input.returned.endsOn.getTime() > input.pickup.endsOn.getTime(),
  });
}
