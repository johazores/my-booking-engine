import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';

export function materializeTravelportStaysReservationOperationInput<
  T extends object,
  K extends keyof T,
>(
  input: T,
  fields: readonly K[],
  failureMessage: string,
): Readonly<Pick<T, K>> {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new TypeError('Travelport reservation operation input must be an object.');
    }

    const entries = fields.map((field) => [field, input[field]] as const);
    return Object.freeze(Object.fromEntries(entries)) as Readonly<Pick<T, K>>;
  } catch {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', failureMessage);
  }
}
