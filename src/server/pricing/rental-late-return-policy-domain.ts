import { RentalInventoryValidationError } from '../inventory/rental-domain.ts';
import { parseMoneyMajorToMinor, PricingValidationError } from './money.ts';

export type RentalLateReturnPolicyMode = 'ENABLE' | 'DISABLE';

export type RentalLateReturnPolicyInput = Readonly<{
  mode: string;
  graceDays: string;
  dailyFeeAmountMajor: string;
  reason: string;
  expectedVersion: string;
}>;

function normalizeReason(value: string) {
  const reason = value.trim().replace(/\s+/g, ' ');
  if (!reason) throw new RentalInventoryValidationError('Late-return policy reason is required.');
  if (reason.length > 1000) throw new RentalInventoryValidationError('Late-return policy reason is too long.');
  return reason;
}

function normalizeExpectedVersion(value: string) {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new RentalInventoryValidationError('Late-return policy version is invalid.');
  }
  const version = Number(normalized);
  if (!Number.isSafeInteger(version) || version < 0 || version > 2_147_483_646) {
    throw new RentalInventoryValidationError('Late-return policy version is invalid.');
  }
  return version;
}

function normalizeGraceDays(value: string) {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new RentalInventoryValidationError('Late-return policy grace days must be a whole number.');
  }
  const graceDays = Number(normalized);
  if (!Number.isSafeInteger(graceDays) || graceDays < 0 || graceDays > 30) {
    throw new RentalInventoryValidationError('Late-return policy grace days must be between 0 and 30.');
  }
  return graceDays;
}

export function normalizeRentalLateReturnPolicyInput(input: RentalLateReturnPolicyInput, currency: string) {
  const mode = input.mode.trim().toUpperCase();
  if (mode !== 'ENABLE' && mode !== 'DISABLE') {
    throw new RentalInventoryValidationError('Late-return policy action is invalid.');
  }

  const reason = normalizeReason(input.reason);
  const expectedVersion = normalizeExpectedVersion(input.expectedVersion);

  if (mode === 'DISABLE') {
    return Object.freeze({
      mode: 'DISABLE' as const,
      enabled: false,
      graceDays: 0,
      dailyFeeMinor: null,
      currency,
      reason,
      expectedVersion,
    });
  }

  const graceDays = normalizeGraceDays(input.graceDays);
  let dailyFeeMinor: bigint;
  try {
    dailyFeeMinor = parseMoneyMajorToMinor(input.dailyFeeAmountMajor.trim(), currency).amountMinor;
  } catch (error) {
    if (error instanceof PricingValidationError) {
      throw new RentalInventoryValidationError(`Late-return daily fee is invalid: ${error.message}`);
    }
    throw error;
  }
  if (dailyFeeMinor <= 0n) {
    throw new RentalInventoryValidationError('Late-return daily fee must be greater than zero.');
  }

  return Object.freeze({
    mode: 'ENABLE' as const,
    enabled: true,
    graceDays,
    dailyFeeMinor,
    currency,
    reason,
    expectedVersion,
  });
}

export function rentalLateReturnPolicyMatches(
  policy: Readonly<{
    enabled: boolean;
    graceDays: number;
    dailyFeeMinor: bigint | null;
    currency: string;
    reason: string;
  }>,
  requested: Readonly<{
    enabled: boolean;
    graceDays: number;
    dailyFeeMinor: bigint | null;
    currency: string;
    reason: string;
  }>,
) {
  return policy.enabled === requested.enabled
    && policy.graceDays === requested.graceDays
    && policy.dailyFeeMinor === requested.dailyFeeMinor
    && policy.currency === requested.currency
    && policy.reason === requested.reason;
}
