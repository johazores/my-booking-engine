import type {
  HospitalitySupplierOfferRevalidationInput,
  HospitalitySupplierOfferSearchInput,
  HospitalitySupplierSearchPageInput,
  HospitalitySupplierSearchInput,
} from './hospitality-supplier-provider.ts';
import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import type { HospitalitySupplierReservationAuthorityInput } from './hospitality-supplier-reservation-authority.ts';

const MAX_CHILDREN = 8;

function invalidMaterialization(): never {
  throw new HospitalitySupplierProviderError(
    'INVALID_REQUEST',
    'Travelport supplier input could not be materialized safely.',
  );
}

function childAgesSnapshot(value: unknown): readonly number[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) invalidMaterialization();

  const length = value.length;
  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_CHILDREN) {
    invalidMaterialization();
  }

  const childAges: number[] = [];
  for (let index = 0; index < length; index += 1) {
    childAges.push(value[index] as number);
  }
  return Object.freeze(childAges);
}

function materialize<T>(read: () => T): T {
  try {
    return read();
  } catch {
    invalidMaterialization();
  }
}

/** Safely snapshot optional occupancy at compatibility-core entry points too.
 * Core classes can be used directly, without their public adapter wrappers. */
export function materializeTravelportStaysChildAges(read: () => unknown): readonly number[] | undefined {
  return materialize(() => childAgesSnapshot(read()));
}

function readOfferSearchInput(input: HospitalitySupplierOfferSearchInput) {
  const supplierPropertyReference = input.supplierPropertyReference;
  const checkInDateLocal = input.checkInDateLocal;
  const checkOutDateLocal = input.checkOutDateLocal;
  const rooms = input.rooms;
  const adults = input.adults;
  const childAges = childAgesSnapshot(input.childAges);
  const currency = input.currency;

  return {
    supplierPropertyReference,
    checkInDateLocal,
    checkOutDateLocal,
    rooms,
    adults,
    ...(childAges === undefined ? {} : { childAges }),
    currency,
  };
}

export function materializeTravelportStaysSearchInput(
  input: HospitalitySupplierSearchInput,
): HospitalitySupplierSearchInput {
  return materialize(() => {
    const childAges = childAgesSnapshot(input.childAges);
    return Object.freeze({
      cityIataCode: input.cityIataCode,
      checkInDateLocal: input.checkInDateLocal,
      checkOutDateLocal: input.checkOutDateLocal,
      rooms: input.rooms,
      adults: input.adults,
      ...(childAges === undefined ? {} : { childAges }),
      radiusKm: input.radiusKm,
    });
  });
}

export function materializeTravelportStaysSearchPageInput(
  input: HospitalitySupplierSearchPageInput,
): HospitalitySupplierSearchPageInput {
  return materialize(() => Object.freeze({
    pageToken: input.pageToken,
    pageNumber: input.pageNumber,
  }));
}

export function materializeTravelportStaysOfferSearchInput(
  input: HospitalitySupplierOfferSearchInput,
): HospitalitySupplierOfferSearchInput {
  return materialize(() => Object.freeze(readOfferSearchInput(input)));
}

export function materializeTravelportStaysOfferRevalidationInput(
  input: HospitalitySupplierOfferRevalidationInput,
): HospitalitySupplierOfferRevalidationInput {
  return materialize(() => Object.freeze({
    ...readOfferSearchInput(input),
    supplierOfferReference: input.supplierOfferReference,
    expectedTotalMinor: input.expectedTotalMinor,
    expectedOfferFingerprint: input.expectedOfferFingerprint,
  }));
}

export function materializeTravelportStaysReservationAuthorityInput(
  input: HospitalitySupplierReservationAuthorityInput,
): HospitalitySupplierReservationAuthorityInput {
  return materialize(() => Object.freeze({
    ...readOfferSearchInput(input),
    supplierOfferReference: input.supplierOfferReference,
    expectedTotalMinor: input.expectedTotalMinor,
    expectedOfferFingerprint: input.expectedOfferFingerprint,
    expectedTermsFingerprint: input.expectedTermsFingerprint,
  }));
}
