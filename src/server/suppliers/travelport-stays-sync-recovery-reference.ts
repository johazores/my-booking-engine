const PREFIX = 'travelport-stays-sync-v1';
const MAX_OFFER_AUTHORITY_LENGTH = 64;
const BOOKING_DOT_COM_SUPPLIER_SOURCE = 'BO';

export type TravelportStaysSyncRecoveryAuthority = Readonly<{
  offerAuthority: string;
  supplierSource: 'BO';
}>;

export class TravelportStaysSyncRecoveryReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TravelportStaysSyncRecoveryReferenceError';
  }
}

function offerAuthority(value: unknown) {
  if (typeof value !== 'string') {
    throw new TravelportStaysSyncRecoveryReferenceError('Travelport Sync offer authority is required.');
  }
  const normalized = value.trim();
  if (
    !normalized
    || normalized !== value
    || normalized.length > MAX_OFFER_AUTHORITY_LENGTH
    || /[\u0000-\u001f\u007f:]/.test(normalized)
  ) {
    throw new TravelportStaysSyncRecoveryReferenceError('Travelport Sync offer authority is invalid.');
  }
  return normalized;
}

function supplierSource(value: unknown): 'BO' {
  if (value !== BOOKING_DOT_COM_SUPPLIER_SOURCE) {
    throw new TravelportStaysSyncRecoveryReferenceError(
      'Travelport Sync recovery authority is limited to verified Booking.com supplier evidence.',
    );
  }
  return BOOKING_DOT_COM_SUPPLIER_SOURCE;
}

export function createTravelportStaysSyncRecoveryReference(input: Readonly<{
  offerAuthority: unknown;
  supplierSource: unknown;
}>) {
  return `${PREFIX}:${offerAuthority(input.offerAuthority)}:${supplierSource(input.supplierSource)}`;
}

export function parseTravelportStaysSyncRecoveryReference(
  value: unknown,
): TravelportStaysSyncRecoveryAuthority {
  if (typeof value !== 'string' || value !== value.trim() || /[\r\n]/.test(value)) {
    throw new TravelportStaysSyncRecoveryReferenceError('Travelport Sync recovery reference is invalid.');
  }
  const parts = value.split(':');
  if (parts.length !== 3 || parts[0] !== PREFIX) {
    throw new TravelportStaysSyncRecoveryReferenceError('Travelport Sync recovery reference is invalid.');
  }
  const authority = offerAuthority(parts[1]);
  const source = supplierSource(parts[2]);
  if (createTravelportStaysSyncRecoveryReference({ offerAuthority: authority, supplierSource: source }) !== value) {
    throw new TravelportStaysSyncRecoveryReferenceError('Travelport Sync recovery reference is invalid.');
  }
  return Object.freeze({ offerAuthority: authority, supplierSource: source });
}
