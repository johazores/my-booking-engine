import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';

const MAX_SUPPLIER_PROPERTY_REFERENCE_LENGTH = 4_096;
const ASCII_CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;

export type TravelportStaysReservationExpectationInput = Readonly<{
  supplierPropertyReference: unknown;
  arrivalDateLocal: unknown;
  departureDateLocal: unknown;
  rooms: unknown;
  adults: unknown;
  childAges?: unknown;
}>;

export type TravelportStaysReservationExpectation = Readonly<{
  chainCode: string;
  propertyCode: string;
  arrivalDateLocal: string;
  departureDateLocal: string;
  rooms: 1;
  guests: number;
}>;

type MaterializedTravelportStaysReservationExpectationInput = Readonly<{
  supplierPropertyReference: unknown;
  arrivalDateLocal: unknown;
  departureDateLocal: unknown;
  rooms: unknown;
  adults: unknown;
  childAges: readonly unknown[];
}>;

function invalidRequest(message: string): never {
  throw new HospitalitySupplierProviderError('INVALID_REQUEST', message);
}

function boundedMachineToken(value: unknown, label: string, max: number) {
  if (
    typeof value !== 'string'
    || !value
    || value.trim() !== value
    || value.length > max
    || ASCII_CONTROL_PATTERN.test(value)
  ) {
    invalidRequest(`${label} is invalid.`);
  }
  return value;
}

function localDate(value: unknown, label: string) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    invalidRequest(`${label} is invalid.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    invalidRequest(`${label} is invalid.`);
  }
  return value;
}

function safelyMaterialize<T>(reader: () => T): T {
  try {
    return reader();
  } catch {
    invalidRequest('Expected reservation evidence could not be materialized safely.');
  }
}

function materializeReservationExpectationInput(
  input: TravelportStaysReservationExpectationInput | undefined,
): MaterializedTravelportStaysReservationExpectationInput {
  if (!input || typeof input !== 'object') {
    invalidRequest('Expected reservation evidence is required.');
  }
  if (safelyMaterialize(() => Array.isArray(input))) {
    invalidRequest('Expected reservation evidence is required.');
  }

  const values = safelyMaterialize(() => ({
    supplierPropertyReference: input.supplierPropertyReference,
    arrivalDateLocal: input.arrivalDateLocal,
    departureDateLocal: input.departureDateLocal,
    rooms: input.rooms,
    adults: input.adults,
    childAgesValue: input.childAges,
  }));
  if (!safelyMaterialize(() => Array.isArray(values.childAgesValue))) {
    invalidRequest('Expected reservation child ages are invalid.');
  }
  const childAges = safelyMaterialize(
    () => Object.freeze([...(values.childAgesValue as unknown[])]),
  ) as readonly unknown[];

  return Object.freeze({
    supplierPropertyReference: values.supplierPropertyReference,
    arrivalDateLocal: values.arrivalDateLocal,
    departureDateLocal: values.departureDateLocal,
    rooms: values.rooms,
    adults: values.adults,
    childAges,
  });
}

export function decodeTravelportStaysPropertyReference(value: unknown) {
  const encoded = boundedMachineToken(
    value,
    'Supplier property reference',
    MAX_SUPPLIER_PROPERTY_REFERENCE_LENGTH,
  );
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) {
    invalidRequest('Supplier property reference is invalid.');
  }

  let decodedBytes: Buffer;
  let decoded: unknown;
  try {
    decodedBytes = Buffer.from(encoded, 'base64url');
    if (decodedBytes.toString('base64url') !== encoded) {
      invalidRequest('Supplier property reference is invalid.');
    }
    decoded = JSON.parse(decodedBytes.toString('utf8'));
  } catch (error) {
    if (error instanceof HospitalitySupplierProviderError) throw error;
    invalidRequest('Supplier property reference is invalid.');
  }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
    invalidRequest('Supplier property reference is invalid.');
  }

  const identity = decoded as Record<string, unknown>;
  const chainCode = typeof identity.chainCode === 'string' ? identity.chainCode : '';
  const propertyCode = typeof identity.propertyCode === 'string' ? identity.propertyCode : '';
  if (
    identity.authority !== 'TVPT'
    || !/^[A-Za-z0-9]{1,16}$/.test(chainCode)
    || !/^[A-Za-z0-9]{1,32}$/.test(propertyCode)
  ) {
    invalidRequest('Supplier property reference is invalid.');
  }

  return Object.freeze({ chainCode, propertyCode });
}

export function normalizeTravelportStaysReservationExpectation(
  input: TravelportStaysReservationExpectationInput | undefined,
): TravelportStaysReservationExpectation {
  const authority = materializeReservationExpectationInput(input);
  const property = decodeTravelportStaysPropertyReference(authority.supplierPropertyReference);
  const arrivalDateLocal = localDate(authority.arrivalDateLocal, 'Arrival date');
  const departureDateLocal = localDate(authority.departureDateLocal, 'Departure date');
  const childAges = authority.childAges;
  const adults = authority.adults;
  if (
    departureDateLocal <= arrivalDateLocal
    || authority.rooms !== 1
    || !Number.isInteger(adults)
    || (adults as number) < 1
    || childAges.length > 8
    || childAges.some((age) => !Number.isInteger(age) || (age as number) < 0 || (age as number) > 17)
    || (adults as number) + childAges.length > 9
  ) {
    invalidRequest('Travelport reservation supports the current single-room one-to-nine-guest contract only.');
  }

  return Object.freeze({
    ...property,
    arrivalDateLocal,
    departureDateLocal,
    rooms: 1,
    guests: (adults as number) + childAges.length,
  });
}
